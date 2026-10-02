import { CLASSIC_QUOTES } from '../data/classicQuotes.js';
import { Quote } from '../models/Quote.js';
import { getSettings, updateSettings } from './settings.js';

/**
 * Chooses the next quote for a reader. Every quote is shown once before any comes back (a new
 * "round" starts when they've all been seen), and never from the same book as the one before.
 * `seen` holds the ids already shown this round; `lastBook` is the previous quote's bookKey.
 * Returns { quote, reset } where reset means a new round started (the reader forgets `seen`).
 */
export function pickQuote(quotes, { seen = [], lastBook = null, random = Math.random } = {}) {
  if (!quotes.length) return { quote: null, reset: false };
  const seenIds = new Set(seen.map(String));
  let unseen = quotes.filter((q) => !seenIds.has(String(q._id)));
  const otherBooks = quotes.some((q) => q.bookKey !== lastBook);
  let reset = false;
  // Everything seen, or nothing new from another book while other books exist: new round.
  if (!unseen.length || (otherBooks && !unseen.some((q) => q.bookKey !== lastBook))) {
    reset = true;
    const previous = String(seen.at(-1));
    unseen = quotes.length > 1 ? quotes.filter((q) => String(q._id) !== previous) : quotes;
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
  return { quote: fromBook[Math.floor(random() * fromBook.length)], reset };
}

// Adds the classic quotes that aren't in the list yet. Returns how many were added.
export async function importClassicQuotes(user) {
  const existing = new Set((await Quote.find().select('text').lean()).map((q) => q.text));
  const missing = CLASSIC_QUOTES.filter((q) => !existing.has(q.text));
  if (missing.length) await Quote.create(missing.map((q) => ({ ...q, createdBy: user?._id })));
  return missing.length;
}

// On the first start, fill the empty quote list with the classics (once: an admin who deletes
// them all doesn't get them back on the next restart).
export async function seedClassicQuotes() {
  if ((await getSettings()).quotesSeeded) return 0;
  const added = (await Quote.estimatedDocumentCount()) === 0 ? await importClassicQuotes() : 0;
  await updateSettings({ quotesSeeded: true });
  return added;
}

