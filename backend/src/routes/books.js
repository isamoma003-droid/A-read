import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { optionalAuth } from '../middleware/auth.js';
import { uploadAudio, uploadBook, uploadCover } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { Assignment } from '../models/Assignment.js';
import { Book } from '../models/Book.js';
import { Bookmark } from '../models/Bookmark.js';
import { Progress } from '../models/Progress.js';
import { Section, unpackParagraphs } from '../models/Section.js';
import {
  attachAudiobook,
  createBook,
  deleteBook,
  parseTags,
  removeAudiobook,
  replaceCover,
} from '../services/books.js';
import { deleteNarration, isNarrating, startNarration, stopNarration } from '../services/narration.js';
import { badRequest, forbidden, notFound, unauthorized } from '../utils/httpError.js';

const router = Router();
// The catalogue (list, details, table of contents) is public so it can be browsed and indexed.
// Reading, listening and changing anything needs an account.
router.use(optionalAuth);

function signedIn(req, _res, next) {
  if (!req.user) throw unauthorized('Sign in to read and listen');
  next();
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function findBook(id) {
  const book = await Book.findById(id).populate('uploadedBy', 'name');
  if (!book) throw notFound('Book not found');
  return book;
}

async function findEditableBook(req) {
  const book = await findBook(req.params.id);
  if (!book.canEdit(req.user)) throw forbidden('Only the person who uploaded this book (or an admin) can change it');
  return book;
}

function present(book, user, progress) {
  const json = book.toJSON();
  if (!user) {
    // Guests see the catalogue entry, not the downloadable files.
    delete json.file;
    if (json.audiobook) json.audiobook = { duration: json.audiobook.duration, originalName: json.audiobook.originalName };
  }
  return {
    ...json,
    canEdit: book.canEdit(user),
    hasAudio: Boolean(book.audiobook?.url) || ['ready', 'partial'].includes(book.narration?.status),
    progress: progress ? { percent: progress.percent, updatedAt: progress.updatedAt } : null,
  };
}

// --- Library ----------------------------------------------------------------------------------

const listSchema = z.object({
  q: z.string().trim().max(200).optional(),
  format: z.enum(['pdf', 'epub', 'txt']).optional(),
  audio: z.enum(['any', 'narration', 'audiobook']).optional(),
  tag: z.string().trim().toLowerCase().max(50).optional(),
  mine: z.stringbool().optional(),
  sort: z.enum(['recent', 'title', 'author']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

const SORTS = { recent: { createdAt: -1 }, title: { sortTitle: 1 }, author: { sortAuthor: 1, sortTitle: 1 } };

router.get('/', validate(listSchema, 'query'), async (req, res) => {
  const { q, format, audio, tag, mine, sort, page, limit } = req.valid.query;
  const and = [];
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ title: pattern }, { author: pattern }, { tags: pattern }, { description: pattern }] });
  }
  if (format) and.push({ format });
  if (tag) and.push({ tags: tag });
  if (mine && req.user) and.push({ uploadedBy: req.user._id });
  const hasNarration = { 'narration.status': { $in: ['ready', 'partial'] } };
  const hasAudiobook = { 'audiobook.url': { $exists: true } };
  if (audio === 'narration') and.push(hasNarration);
  if (audio === 'audiobook') and.push(hasAudiobook);
  if (audio === 'any') and.push({ $or: [hasNarration, hasAudiobook] });
  const filter = and.length ? { $and: and } : {};

  const [books, total] = await Promise.all([
    Book.find(filter)
      .select('-toc -description')
      .sort(SORTS[sort])
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('uploadedBy', 'name'),
    Book.countDocuments(filter),
  ]);

  const progress = req.user ? await Progress.find({ user: req.user._id, book: { $in: books.map((b) => b._id) } }) : [];
  const byBook = new Map(progress.map((p) => [String(p.book), p]));
  res.json({
    books: books.map((book) => present(book, req.user, byBook.get(String(book._id)))),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

router.get('/tags', async (_req, res) => {
  const tags = await Book.aggregate([
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 50 },
  ]);
  res.json({ tags: tags.map((t) => ({ tag: t._id, count: t.count })) });
});

// --- Single book ------------------------------------------------------------------------------

const createSchema = z.object({
  title: z.string().trim().max(300).optional(),
  author: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  language: z.string().trim().max(20).optional(),
  tags: z.string().max(500).optional(),
});

router.post('/', signedIn, uploadBook, validate(createSchema), async (req, res) => {
  const book = await createBook({ user: req.user, files: req.files, fields: req.valid.body });
  await book.populate('uploadedBy', 'name');
  res.status(201).json({ book: present(book, req.user) });
});

router.get('/:id', async (req, res) => {
  const book = await findBook(req.params.id);
  const [progress, assignment] = req.user
    ? await Promise.all([
        Progress.findOne({ user: req.user._id, book: book._id }),
        Assignment.findOne({ book: book._id, $or: [{ everyone: true }, { users: req.user._id }] }).sort({ dueDate: 1 }),
      ])
    : [null, null];
  res.json({
    book: {
      ...present(book, req.user, progress),
      finishedAt: progress?.completedAt ?? null,
      requiredReading: assignment ? { id: assignment.id, dueDate: assignment.dueDate ?? null, note: assignment.note } : null,
    },
  });
});

const updateSchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty').max(300).optional(),
  author: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  language: z.string().trim().max(20).optional(),
  tags: z.union([z.string().max(500), z.array(z.string().max(50)).max(20)]).optional(),
});

router.patch('/:id', signedIn, validate(updateSchema), async (req, res) => {
  const book = await findEditableBook(req);
  const { tags, ...fields } = req.valid.body;
  book.set(fields);
  if (tags !== undefined) book.tags = parseTags(tags);
  await book.save();
  res.json({ book: present(book, req.user) });
});

router.delete('/:id', signedIn, async (req, res) => {
  const book = await findEditableBook(req);
  await deleteBook(book);
  res.status(204).end();
});

router.put('/:id/cover', signedIn, uploadCover, async (req, res) => {
  const book = await findEditableBook(req);
  await replaceCover(book, req.file);
  res.json({ book: present(book, req.user) });
});

// --- Text ------------------------------------------------------------------------------------

router.get('/:id/sections', async (req, res) => {
  const book = await findBook(req.params.id);
  const sections = await Section.find({ book: book._id })
    .sort({ index: 1 })
    .select('index title href wordCount sentenceCount narration.duration narration.voice')
    .lean();
  res.json({
    sections: sections.map((s) => ({
      index: s.index,
      title: s.title,
      href: s.href,
      wordCount: s.wordCount,
      sentenceCount: s.sentenceCount,
      narrationDuration: s.narration?.duration ?? null,
    })),
  });
});

router.get('/:id/sections/:index', signedIn, async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) throw badRequest('Invalid section number');
  const section = await Section.findOne({ book: req.params.id, index }).lean();
  if (!section) throw notFound('Section not found');
  const { _id, __v, book: _book, sentences, paragraphStarts, ...rest } = section;
  res.json({ section: { ...rest, paragraphs: unpackParagraphs(sentences, paragraphStarts) } });
});

// --- Audio ----------------------------------------------------------------------------------

router.post('/:id/audiobook', signedIn, uploadAudio, async (req, res) => {
  const book = await findEditableBook(req);
  await attachAudiobook(book, req.file, req.user);
  res.json({ book: present(book, req.user) });
});

router.delete('/:id/audiobook', signedIn, async (req, res) => {
  const book = await findEditableBook(req);
  await removeAudiobook(book);
  res.json({ book: present(book, req.user) });
});

router.get('/:id/narration', async (req, res) => {
  const book = await Book.findById(req.params.id).select('narration');
  if (!book) throw notFound('Book not found');
  res.json({ narration: book.narration, running: isNarrating(book._id) });
});

const narrationSchema = z.object({
  voice: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+-[A-Z0-9]+$/, 'Pick a voice such as en-US-Neural2-F')
    .default(env.defaultTtsVoice),
});

router.post('/:id/narration', signedIn, validate(narrationSchema), async (req, res) => {
  const book = await findEditableBook(req);
  await startNarration(book, { voice: req.valid.body.voice, user: req.user });
  res.status(202).json({ narration: book.narration, running: true });
});

// Cancels a running job (keeping what's done) or, with ?purge=true, deletes all narration audio.
router.delete('/:id/narration', signedIn, async (req, res) => {
  const book = await findEditableBook(req);
  if (req.query.purge === 'true') {
    await deleteNarration(book);
  } else {
    await stopNarration(book._id);
  }
  const fresh = await Book.findById(book._id).select('narration');
  res.json({ narration: fresh.narration, running: false });
});

// --- Bookmarks -------------------------------------------------------------------------------

const bookmarkSchema = z.object({
  sectionIndex: z.number().int().min(0),
  sentenceIndex: z.number().int().min(0).default(0),
  epubCfi: z.string().max(500).optional(),
  audiobookTime: z.number().min(0).optional(),
  label: z.string().trim().max(200).default(''),
  note: z.string().trim().max(2000).default(''),
  snippet: z.string().trim().max(300).default(''),
});

router.get('/:id/bookmarks', signedIn, async (req, res) => {
  const bookmarks = await Bookmark.find({ user: req.user._id, book: req.params.id }).sort({ sectionIndex: 1, sentenceIndex: 1 });
  res.json({ bookmarks });
});

router.post('/:id/bookmarks', signedIn, validate(bookmarkSchema), async (req, res) => {
  const book = await findBook(req.params.id);
  const bookmark = await Bookmark.create({ ...req.valid.body, user: req.user._id, book: book._id });
  res.status(201).json({ bookmark });
});

export default router;
