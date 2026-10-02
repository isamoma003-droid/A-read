import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Book } from '../models/Book.js';
import { Quote } from '../models/Quote.js';
import { importClassicQuotes, pickQuote } from '../services/quotes.js';
import { getSettings } from '../services/settings.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';

const router = Router();
const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

const publicQuote = (q) => ({
  id: String(q._id),
  text: q.text,
  bookTitle: q.bookTitle,
  author: q.author,
  bookKey: q.bookKey,
  book: q.book?._id ? { id: String(q.book._id), title: q.book.title, cover: q.book.cover } : null,
});

const nextSchema = z.object({
  // Quote ids this visitor has already seen this round (the app keeps them on the device).
  seen: z.array(objectId).max(5000).default([]),
  lastBook: z.string().max(300).nullable().optional(),
});

// The quote to show now: one not seen yet, from a different book than the last one.
router.post('/next', validate(nextSchema), async (req, res) => {
  if (!(await getSettings()).quotesEnabled) return res.json({ quote: null, reset: false, keep: [] });
  const quotes = await Quote.find({ enabled: true }).select('text bookTitle author bookKey book').populate('book', 'title cover').lean();
  const { quote, reset, keep } = pickQuote(quotes, req.valid.body);
  res.json({ quote: quote ? publicQuote(quote) : null, reset, keep });
});

// --- Admin ---------------------------------------------------------------------------------

router.use(requireAuth, requireAdmin);

router.get('/', async (_req, res) => {
  const quotes = await Quote.find().sort({ createdAt: -1 }).populate('book', 'title cover');
  res.json({ quotes: quotes.map((q) => ({ ...publicQuote(q), enabled: q.enabled, createdAt: q.createdAt })) });
});

const fields = {
  text: z.string().trim().min(1, 'Write the quote').max(1000),
  bookTitle: z.string().trim().max(300),
  author: z.string().trim().max(200),
  bookId: objectId.nullable(),
  enabled: z.boolean(),
};
const createSchema = z.object({
  text: fields.text,
  bookTitle: fields.bookTitle.optional(),
  author: fields.author.optional(),
  bookId: fields.bookId.optional(),
  enabled: fields.enabled.default(true),
});
const updateSchema = z.object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])));

// A quote linked to a library book takes its title and author unless the admin typed others.
async function apply(quote, { bookId, ...body }) {
  if (bookId !== undefined) {
    const book = bookId ? await Book.findById(bookId).select('title author') : null;
    if (bookId && !book) throw notFound('Book not found');
    quote.book = book?._id;
    if (book && !body.bookTitle) body.bookTitle = book.title;
    if (book && body.author === undefined) body.author = book.author;
  }
  for (const [key, value] of Object.entries(body)) if (value !== undefined) quote[key] = value;
  if (!quote.bookTitle) throw badRequest('Which book is it from? Pick a book or type its title.');
  await quote.save().catch((err) => {
    throw err.code === 11000 ? conflict('That quote is already in the list') : err;
  });
  await quote.populate('book', 'title cover');
  return { ...publicQuote(quote), enabled: quote.enabled, createdAt: quote.createdAt };
}

router.post('/', validate(createSchema), async (req, res) => {
  res.status(201).json({ quote: await apply(new Quote({ createdBy: req.user._id }), req.valid.body) });
});

router.patch('/:id', validate(updateSchema), async (req, res) => {
  const quote = await Quote.findById(req.params.id);
  if (!quote) throw notFound('Quote not found');
  res.json({ quote: await apply(quote, req.valid.body) });
});

router.delete('/:id', async (req, res) => {
  const result = await Quote.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) throw notFound('Quote not found');
  res.status(204).end();
});

// Adds the built-in classic quotes that aren't in the list (again).
router.post('/classics', async (req, res) => {
  res.json({ added: await importClassicQuotes(req.user) });
});

export default router;
