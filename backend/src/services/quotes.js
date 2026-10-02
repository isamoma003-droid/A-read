import { CLASSIC_QUOTES } from '../data/classicQuotes.js';
import { Quote } from '../models/Quote.js';
import { getSettings, updateSettings } from './settings.js';

/**
 * Chooses the next quote for a reader. Every quote is shown once before any comes back (a new
 * "round" starts when they've all been seen), and never from the same book as the one before.
 * `seen` holds the ids already shown this round; `lastBook` is the previous quote's bookKey.
 * Returns { quote, reset, keep }: on reset the reader replaces `seen` with `keep` (the quotes that
 * still count as seen in the new round) before adding the new quote.
 */
export function pickQuote(quotes, { seen = [], lastBook = null, random = Math.random } = {}) {
  if (!quotes.length) return { quote: null, reset: false, keep: [] };
  const id = (q) => String(q._id);
  const seenIds = new Set(seen.map(String));
  let unseen = quotes.filter((q) => !seenIds.has(id(q)));
  let reset = false;
  let keep = [];
  if (!unseen.length) {
    // Everything seen: start again with every quote except the one just shown.
    reset = true;
    const previous = String(seen.at(-1));
    unseen = quotes.length > 1 ? quotes.filter((q) => id(q) !== previous) : quotes;
  } else if (quotes.some((q) => q.bookKey !== lastBook) && !unseen.some((q) => q.bookKey !== lastBook)) {
    // Only the last book has quotes left: the other books start over, but the last book's quotes
    // already shown stay seen, so its new ones still come before any of them repeat.
    reset = true;
    keep = quotes.filter((q) => q.bookKey === lastBook && seenIds.has(id(q))).map(id);
    unseen = quotes.filter((q) => q.bookKey !== lastBook);
  }
  const candidates = unseen.filter((q) => q.bookKey !== lastBook);
  // Only one book has quotes at all: there is no other book to switch to.
  const pool = candidates.length ? candidates : unseen;

  // Take from the book with the most quotes left this round, so books keep alternating and the
  // round doesn't end with several quotes from one book in a row.
  const byBook = new Map();
  for (const q of pool) byBook.set(q.bookKey, [...(byBook.get(q.bookKey) || []), q]);
  const most = Math.max(...[...byBook.values()].map((list) => list.length));
  const books = [...byBook.values()].filter((list) => list.length === most);
  const fromBook = books[Math.floor(random() * books.length)];
  return { quote: fromBook[Math.floor(random() * fromBook.length)], reset, keep };
}

// Quote text is unique, so the same line can't be listed twice. A database that already has
// duplicates (from before that rule) keeps the oldest of each, then gets the index. Built once per
// process; a failure is retried on the next call.
let indexed = null;
export function ensureQuoteIndexes() {
  indexed ??= (async () => {
    await removeDuplicateQuotes();
    await Quote.createIndexes();
  })().catch((err) => {
    indexed = null;
    throw err;
  });
  return indexed;
}

export async function removeDuplicateQuotes() {
  const groups = await Quote.aggregate([
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: { _id: '$text', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  const extra = groups.flatMap((g) => g.ids.slice(1));
  if (extra.length) await Quote.deleteMany({ _id: { $in: extra } });
  return extra.length;
}

// Adds the classic quotes that aren't in the list yet. Returns how many were added. Two imports at
// once (a double click, or two servers starting) can't add the same quote twice.
export async function importClassicQuotes(user) {
  await ensureQuoteIndexes();
  const existing = new Set((await Quote.find().select('text').lean()).map((q) => q.text));
  const missing = CLASSIC_QUOTES.filter((q) => !existing.has(q.text));
  if (!missing.length) return 0;
  try {
    const added = await Quote.insertMany(
      missing.map((q) => ({ ...q, createdBy: user?._id })),
      { ordered: false },
    );
    return added.length;
  } catch (err) {
    const errors = err.writeErrors ?? [];
    if (!errors.length || errors.some((e) => (e.code ?? e.err?.code) !== 11000)) throw err;
    return err.insertedDocs?.length ?? err.result?.insertedCount ?? 0;
  }
}

// On the first start, fill the empty quote list with the classics. Only once: an admin who deletes
// them all doesn't get them back on the next restart. The flag is set after the import, so a start
// that fails part-way tries again next time (the unique text keeps two servers from doubling up).
export async function seedClassicQuotes() {
  await ensureQuoteIndexes();
  if ((await getSettings()).quotesSeeded) return 0;
  const added = (await Quote.estimatedDocumentCount()) === 0 ? await importClassicQuotes() : 0;
  await updateSettings({ quotesSeeded: true });
  return added;
}
