// Works out a book's category from the book itself: its title, tags, description, chapter titles
// and a sample of its text, compared with each category's name and keywords, the words A-Read knows
// for common categories (data/categoryKeywords.js), and the books admins have already filed there.
// Everything runs inside A-Read; nothing is sent anywhere.
import { CATEGORY_DICTIONARY, STOPWORDS } from '../data/categoryKeywords.js';
import { Book } from '../models/Book.js';
import { slugify } from '../models/Category.js';
import { Section, unpackParagraphs } from '../models/Section.js';

// Bump when the way a text profile is built changes, so cached profiles are rebuilt.
export const PROFILE_VERSION = 1;
const SAMPLE_WORDS = 8000; // words of text read per book…
const WORDS_PER_PART = 700; // …taken in pieces from across the whole book
const MAX_PARTS = 40;
const TOP_TERMS = 400;
const TOP_PAIRS = 150;
const LEARN_PER_CATEGORY = 40; // filed books per category used as examples

// --- Words ----------------------------------------------------------------------------------

// "stories" -> "story", "churches" -> "church", "novels" -> "novel".
export function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

// The meaningful words of a text, lower-cased and singular, without common words or numbers.
export function tokenize(text) {
  const out = [];
  for (const raw of String(text || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || /^\d+$/.test(raw) || STOPWORDS.has(raw)) continue;
    const word = stem(raw);
    if (!STOPWORDS.has(word)) out.push(word);
  }
  return out;
}

// Counts single words and neighbouring word pairs ("world war", "machine learning").
function count(tokens, words = new Map(), pairs = new Map()) {
  tokens.forEach((t, i) => {
    words.set(t, (words.get(t) || 0) + 1);
    if (i > 0) {
      const pair = `${tokens[i - 1]} ${t}`;
      pairs.set(pair, (pairs.get(pair) || 0) + 1);
    }
  });
  return { words, pairs };
}

const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const key = (phrase) => tokenize(phrase).join(' ');
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// --- Text profiles ---------------------------------------------------------------------------

/**
 * Summarises a sample of a book's text: its most frequent words and word pairs, how much of it is
 * dialogue (sentences with quotation marks) and how many paragraphs are short lines (verse).
 * `parts` is a list of sections, each an array of paragraphs, each an array of sentences.
 */
export function buildProfile(parts) {
  const counts = { words: new Map(), pairs: new Map() };
  let words = 0;
  let sentences = 0;
  let quoted = 0;
  let paragraphs = 0;
  let short = 0;
  for (const part of parts) {
    let partWords = 0;
    for (const paragraph of part) {
      if (partWords >= WORDS_PER_PART || words >= SAMPLE_WORDS) break;
      const length = paragraph.join(' ').split(/\s+/).filter(Boolean).length;
      if (!length) continue;
      paragraphs++;
      if (length <= 8) short++;
      for (const sentence of paragraph) {
        sentences++;
        if (/[“”"«»„]/.test(sentence)) quoted++;
        count(tokenize(sentence), counts.words, counts.pairs);
      }
      partWords += length;
      words += length;
    }
  }
  return {
    v: PROFILE_VERSION,
    words,
    dialogue: sentences ? quoted / sentences : 0,
    shortLines: paragraphs ? short / paragraphs : 0,
    terms: top(counts.words, TOP_TERMS),
    pairs: top(counts.pairs, TOP_PAIRS).filter(([, n]) => n > 1),
  };
}

// Picks sections spread across the book, skipping near-empty front matter where possible.
export function pickSections(sections) {
  const body = sections.filter((s) => s.wordCount >= 80);
  const pool = body.length ? body : sections.filter((s) => s.wordCount > 0);
  if (!pool.length) return [];
  const average = pool.reduce((n, s) => n + Math.min(s.wordCount, WORDS_PER_PART), 0) / pool.length;
  const wanted = Math.min(pool.length, MAX_PARTS, Math.ceil(SAMPLE_WORDS / Math.max(average, 1)));
  return [...new Set(Array.from({ length: wanted }, (_, i) => pool[Math.floor((i * pool.length) / wanted)].index))];
}

// Profile for a book being uploaded, from the extractor's sections ({ paragraphs, wordCount }).
export function profileFromExtracted(sections) {
  const picked = new Set(pickSections(sections.map((s, index) => ({ index, wordCount: s.wordCount ?? 0 }))));
  return buildProfile(sections.filter((_, index) => picked.has(index)).map((s) => s.paragraphs));
}

// Builds and stores text profiles for books that don't have a current one. Returns how many.
export async function ensureProfiles(bookIds) {
  const missing = await Book.find({ _id: { $in: bookIds }, 'textProfile.v': { $ne: PROFILE_VERSION } }).select('_id').lean();
  for (const { _id } of missing) {
    const meta = await Section.find({ book: _id }).sort({ index: 1 }).select('index wordCount').lean();
    const indexes = pickSections(meta);
    const sections = await Section.find({ book: _id, index: { $in: indexes } }).sort({ index: 1 }).select('sentences paragraphStarts').lean();
    const profile = buildProfile(sections.map((s) => unpackParagraphs(s.sentences, s.paragraphStarts)));
    // A profile isn't a change to the book, so don't touch updatedAt (offline copies key on it).
    await Book.updateOne({ _id }, { $set: { textProfile: profile } }, { timestamps: false });
  }
  return missing.length;
}

// --- What each category looks like -----------------------------------------------------------

const DICTIONARY = CATEGORY_DICTIONARY.map((entry) => ({
  ...entry,
  aliasKeys: entry.aliases.map((a) => slugify(a).split('-').filter(Boolean).map(stem)),
  termKeys: [...new Set(entry.terms.map(key).filter(Boolean))],
}));
// A word listed for several categories says less about any one of them.
const SPREAD = new Map();
for (const entry of DICTIONARY) for (const t of entry.termKeys) SPREAD.set(t, (SPREAD.get(t) || 0) + 1);

const containsRun = (haystack, needle) =>
  needle.length > 0 && haystack.some((_, i) => needle.every((word, j) => haystack[i + j] === word));

// The built-in entries a category name refers to: "Science & Nature" -> Science & Nature,
// "Novels" -> Fiction, "Dini" -> Religion & Spirituality.
export function dictionaryEntriesFor(name) {
  const words = slugify(name).split('-').filter(Boolean).map(stem);
  return DICTIONARY.filter((entry) => entry.aliasKeys.some((alias) => containsRun(words, alias)));
}

// Words (and pairs) that point to a category, with how strongly each one does.
export function categoryTerms(category) {
  const terms = new Map();
  const add = (term, weight) => term && terms.set(term, Math.max(terms.get(term) || 0, weight));
  const entries = dictionaryEntriesFor(category.name);
  for (const entry of entries) {
    for (const t of entry.termKeys) add(t, 1 / (SPREAD.get(t) || 1));
    for (const alias of entry.aliasKeys) add(alias.join(' '), 1.5);
  }
  for (const word of tokenize(category.name)) add(word, 3);
  for (const keyword of category.keywords || []) add(key(keyword), 2.5);
  return { terms, styles: new Set(entries.map((e) => e.style).filter(Boolean)) };
}

// --- Comparing books --------------------------------------------------------------------------

const FIELDS = { title: [6, 1], tags: [5, 1], description: [2, 3], toc: [1.5, 3] }; // [weight, cap per word]
const TEXT_WEIGHT = 1.2;

function fieldCounts(book) {
  const text = {
    title: book.title,
    tags: (book.tags || []).join(' , '),
    description: book.description,
    toc: (book.toc || []).map((e) => e.title).join(' . '),
  };
  return Object.fromEntries(
    Object.entries(text).map(([field, value]) => {
      const { words, pairs } = count(tokenize(value));
      return [field, new Map([...words, ...pairs])];
    }),
  );
}

// A book's text as a weighted word vector (for comparing with books already filed).
function vectorOf(profile, idf) {
  const vector = new Map();
  let norm = 0;
  for (const [term, n] of profile?.terms || []) {
    const weight = Math.log1p((1000 * n) / Math.max(profile.words, 1)) * (idf.get(term) ?? 1);
    vector.set(term, weight);
    norm += weight * weight;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [term, weight] of vector) vector.set(term, weight / norm);
  return vector;
}

const dot = (a, b) => {
  let sum = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [term, weight] of small) sum += weight * (big.get(term) || 0);
  return sum;
};

/**
 * Prepares to classify books into `categories`. Books already filed by a person (not by A-Read)
 * serve as examples: a book whose words resemble theirs leans towards their category.
 * With `computeMissing`, example books without a text profile get one first (slower).
 */
export async function buildClassifier(categories, { computeMissing = false } = {}) {
  const prepared = categories.map((c) => ({ category: c, id: String(c._id), ...categoryTerms(c) }));
  const examples = [];
  for (const c of prepared) {
    const books = await Book.find({ category: c.category._id, categorySource: { $ne: 'auto' } })
      .sort({ updatedAt: -1 })
      .limit(LEARN_PER_CATEGORY)
      .select('_id')
      .lean();
    if (computeMissing) await ensureProfiles(books.map((b) => b._id));
    const withProfiles = await Book.find({ _id: { $in: books.map((b) => b._id) }, 'textProfile.v': PROFILE_VERSION })
      .select('+textProfile')
      .lean();
    for (const b of withProfiles) examples.push({ id: String(b._id), categoryId: c.id, profile: b.textProfile });
  }

  // How rare each word is across the example books (rare words say more).
  const df = new Map();
  for (const e of examples) for (const [term] of e.profile.terms) df.set(term, (df.get(term) || 0) + 1);
  const idf = new Map([...df].map(([term, n]) => [term, Math.log((examples.length + 1) / (n + 1)) + 1]));
  for (const e of examples) e.vector = vectorOf(e.profile, idf);
  const byCategory = new Map(prepared.map((c) => [c.id, examples.filter((e) => e.categoryId === c.id)]));

  // Similarity to a category's examples, leaving the book itself out if it is one of them.
  function learned(categoryId, vector, bookId) {
    const others = byCategory.get(categoryId).filter((e) => e.id !== bookId);
    if (!others.length || !vector.size) return { similarity: 0, examples: 0 };
    const centroid = new Map();
    for (const e of others) for (const [term, w] of e.vector) centroid.set(term, (centroid.get(term) || 0) + w / others.length);
    const norm = Math.sqrt([...centroid.values()].reduce((n, w) => n + w * w, 0)) || 1;
    return { similarity: dot(vector, centroid) / norm, examples: others.length };
  }

  /**
   * Scores every category for `book` (title, tags, description, toc, _id) with its text `profile`.
   * Returns { category, confidence: 'strong' | 'likely' | null, score, reasons, ranking }.
   */
  function classify(book, profile) {
    const fields = fieldCounts(book);
    const textWords = new Map([...(profile?.terms || []), ...(profile?.pairs || [])]);
    const vector = vectorOf(profile, idf);
    const bookId = String(book._id ?? book.id ?? '');
    const scored = prepared.map((c) => {
      const hits = [];
      let keyword = 0;
      for (const [term, weight] of c.terms) {
        let s = 0;
        for (const [field, [fieldWeight, cap]] of Object.entries(FIELDS)) s += fieldWeight * Math.min(fields[field].get(term) || 0, cap);
        const n = textWords.get(term) || 0;
        if (n && profile?.words) s += TEXT_WEIGHT * Math.min(4, Math.log2(1 + (1000 * n) / profile.words));
        if (s) {
          keyword += s * weight;
          hits.push([term, s * weight]);
        }
      }
      let style = 0;
      const dialogue = profile?.dialogue ?? 0;
      const shortLines = profile?.shortLines ?? 0;
      if (c.styles.has('story')) style += 12 * clamp01((dialogue - 0.06) / 0.25);
      if (c.styles.has('verse')) style += 14 * clamp01((shortLines - 0.35) / 0.4);
      if (c.styles.has('play')) style += 8 * clamp01((shortLines - 0.3) / 0.4);
      const { similarity, examples: seen } = learned(c.id, vector, bookId);
      const learnedScore = 25 * similarity * Math.min(1, (seen + 1) / 4);
      return { c, score: keyword + style + learnedScore, keyword, style, learnedScore, seen, hits };
    });
    scored.sort((a, b) => b.score - a.score);
    const [best, second] = scored;
    const ranking = scored.slice(0, 3).map((s) => ({ id: s.c.id, name: s.c.category.name, score: Math.round(s.score * 10) / 10 }));
    const none = { category: null, confidence: null, score: best ? Math.round(best.score * 10) / 10 : 0, reasons: [], ranking };
    if (!best || best.score < 6) return none;
    const gap = best.score - (second?.score ?? 0);
    if (second && gap < Math.max(2, 0.15 * best.score)) return none;
    const reasons = best.hits.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([term]) => `“${term}”`);
    if (best.style >= 4) reasons.push(best.c.styles.has('story') ? 'reads like a story' : 'written in short lines');
    if (best.learnedScore >= 5) reasons.push(`similar to ${best.seen} book${best.seen === 1 ? '' : 's'} already there`);
    const strong = best.score >= 15 && (!second || best.score >= 1.6 * second.score);
    return {
      category: { id: best.c.id, name: best.c.category.name, slug: best.c.category.slug },
      confidence: strong ? 'strong' : 'likely',
      score: Math.round(best.score * 10) / 10,
      reasons,
      ranking,
    };
  }

  return { classify, examples: examples.length };
}
