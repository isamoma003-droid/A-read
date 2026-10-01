// Shared helpers that turn raw text into paragraphs of sentences.

const MAX_SENTENCE_CHARS = 400;

export function cleanText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
    .replace(/[ \t\f\v]+/g, ' ');
}

export function countWords(text) {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

const segmenters = new Map();
function segmenterFor(language) {
  const key = language || 'en';
  if (!segmenters.has(key)) {
    let segmenter;
    try {
      segmenter = new Intl.Segmenter(key, { granularity: 'sentence' });
    } catch {
      segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    }
    segmenters.set(key, segmenter);
  }
  return segmenters.get(key);
}

// Breaks an over-long run of text (e.g. a PDF line with no punctuation) at the last
// comma, semicolon or space before the limit so TTS utterances stay a sensible length.
function splitLong(sentence) {
  const parts = [];
  let rest = sentence;
  while (rest.length > MAX_SENTENCE_CHARS) {
    const window = rest.slice(0, MAX_SENTENCE_CHARS);
    let cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(', '), window.lastIndexOf(': '));
    if (cut < MAX_SENTENCE_CHARS / 2) cut = window.lastIndexOf(' ');
    if (cut < MAX_SENTENCE_CHARS / 4) cut = MAX_SENTENCE_CHARS - 1;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function splitSentences(paragraph, language) {
  const text = paragraph.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const sentences = [];
  for (const { segment } of segmenterFor(language).segment(text)) {
    const sentence = segment.trim();
    if (!sentence) continue;
    // Glue stray punctuation-only fragments (e.g. a lone closing quote) onto the previous sentence.
    if (sentences.length && !/[\p{L}\p{N}]/u.test(sentence)) {
      sentences[sentences.length - 1] += sentence;
      continue;
    }
    sentences.push(...splitLong(sentence));
  }
  return sentences;
}

// Splits plain text into paragraphs. Blank lines separate paragraphs; hard-wrapped lines
// inside a paragraph are joined. Text without blank lines is treated as one paragraph per line.
export function paragraphsFromPlainText(text) {
  const cleaned = cleanText(text).trim();
  if (!cleaned) return [];
  const blocks = cleaned.split(/\n\s*\n/);
  const singleLineMode = blocks.length === 1 && cleaned.includes('\n');
  const paragraphs = [];
  for (const block of singleLineMode ? cleaned.split('\n') : blocks) {
    const joined = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((acc, line) => {
        if (!acc) return line;
        // Re-join words hyphenated across a line break ("won-\nderful").
        if (/[\p{L}]-$/u.test(acc) && /^\p{Ll}/u.test(line)) return acc.slice(0, -1) + line;
        return `${acc} ${line}`;
      }, '');
    if (joined) paragraphs.push(joined);
  }
  return paragraphs;
}

export function buildSection({ title = '', paragraphs = [], href, language }) {
  const sentenceParagraphs = paragraphs.map((p) => splitSentences(p, language)).filter((p) => p.length);
  const allText = sentenceParagraphs.flat().join(' ');
  return {
    title: title.replace(/\s+/g, ' ').trim().slice(0, 300),
    href,
    paragraphs: sentenceParagraphs,
    wordCount: countWords(allText),
    sentenceCount: sentenceParagraphs.reduce((n, p) => n + p.length, 0),
    charCount: allText.length,
  };
}

export function summarize(sections) {
  return {
    sectionCount: sections.length,
    wordCount: sections.reduce((n, s) => n + s.wordCount, 0),
    charCount: sections.reduce((n, s) => n + s.charCount, 0),
  };
}
