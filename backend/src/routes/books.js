import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { optionalAuth } from '../middleware/auth.js';
import { uploadAudio, uploadBook, uploadCover } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { Assignment } from '../models/Assignment.js';
import { Book } from '../models/Book.js';
import { Bookmark } from '../models/Bookmark.js';
import { Category } from '../models/Category.js';
import { Progress } from '../models/Progress.js';
import { Section, unpackParagraphs } from '../models/Section.js';
import { isAdmin } from '../models/User.js';
import {
  attachAudiobook,
  createBook,
  deleteBook,
  parseTags,
  removeAudiobook,
  replaceCover,
} from '../services/books.js';
import { buildClassifier } from '../services/categorize.js';
import { announce, bookPages } from '../services/indexnow.js';
import { deleteNarration, isNarrating, startNarration, stopNarration } from '../services/narration.js';
import { isPremium, lockedError, lockedFor, lockedSectionsFor, purchasedBookIds } from '../services/premium.js';
import { getSettings } from '../services/settings.js';
import { badRequest, forbidden, notFound, unauthorized } from '../utils/httpError.js';

const router = Router();
// The catalogue (list, details, table of contents) is public so it can be browsed and indexed.
// Reading, listening and changing anything needs an account.
router.use(optionalAuth);

function signedIn(req, _res, next) {
  if (!req.user) throw unauthorized('Sign in to read and listen');
  next();
}

// A super admin can limit uploads to admins (checked before the file is received).
async function mayUpload(req, _res, next) {
  if (!isAdmin(req.user) && (await getSettings()).uploads === 'admins') throw forbidden('Only admins can add books right now');
  next();
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Pick a category from the list');

async function findBook(id) {
  const book = await Book.findById(id).populate('uploadedBy', 'name').populate('category', 'name slug');
  if (!book) throw notFound('Book not found');
  return book;
}

async function findEditableBook(req) {
  const book = await findBook(req.params.id);
  if (!book.canEdit(req.user)) throw forbidden('Only the person who uploaded this book (or an admin) can change it');
  return book;
}

// `locked`: the sections this viewer can't open (see services/premium.js). Without it, nothing
// counts as paid for, which never shows more than it should.
function present(book, user, progress, locked = lockedFor(book, user, new Set())) {
  const json = book.toJSON();
  delete json.textProfile;
  delete json.uploadKey;
  if (!user || locked.size) {
    // Guests see the catalogue entry, not the downloadable files. Nor do readers who haven't
    // unlocked a premium book: its original file and audiobook include the locked chapters.
    delete json.file;
    if (json.audiobook) json.audiobook = { duration: json.audiobook.duration, originalName: json.audiobook.originalName };
  }
  return {
    ...json,
    category: json.category ?? null,
    rating: book.rating?.count ? { average: book.rating.average, count: book.rating.count } : null,
    featuredUntil: book.featuredUntil > new Date() ? book.featuredUntil : null,
    premium: isPremium(book) ? { price: book.premium.price, lockedSections: book.premium.lockedSections } : null,
    // false while any chapter is locked for this viewer.
    unlocked: locked.size === 0,
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
  category: z.string().trim().toLowerCase().max(60).optional(),
  // An author page's slug (/authors/:slug).
  author: z.string().trim().toLowerCase().max(60).optional(),
  access: z.enum(['free', 'premium']).optional(),
  // Only books on the Featured shelf.
  featured: z.stringbool().optional(),
  mine: z.stringbool().optional(),
  sort: z.enum(['recent', 'title', 'author', 'rating']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

// "rating": rated books first, best first (services/reviews.js explains the score).
const SORTS = {
  recent: { createdAt: -1 },
  title: { sortTitle: 1 },
  author: { sortAuthor: 1, sortTitle: 1 },
  rating: { 'rating.score': -1, createdAt: -1 },
};

router.get('/', validate(listSchema, 'query'), async (req, res) => {
  const { q, format, audio, tag, category, author, access, featured, mine, sort, page, limit } = req.valid.query;
  const and = [];
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ title: pattern }, { author: pattern }, { tags: pattern }, { description: pattern }] });
  }
  if (format) and.push({ format });
  if (author) and.push({ 'authors.slug': author });
  if (featured) and.push({ featuredUntil: { $gt: new Date() } });
  if (tag) and.push({ tags: tag });
  if (category === 'none') and.push({ category: null });
  else if (category) {
    const found = await Category.findOne({ slug: category }).select('_id');
    and.push(found ? { category: found._id } : { _id: null });
  }
  if (access === 'premium') and.push({ 'premium.enabled': true });
  if (access === 'free') and.push({ 'premium.enabled': { $ne: true } });
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
      .populate('uploadedBy', 'name')
      .populate('category', 'name slug'),
    Book.countDocuments(filter),
  ]);

  const [progress, purchased] = await Promise.all([
    req.user ? Progress.find({ user: req.user._id, book: { $in: books.map((b) => b._id) } }) : [],
    purchasedBookIds(req.user, books),
  ]);
  const byBook = new Map(progress.map((p) => [String(p.book), p]));
  res.json({
    books: books.map((book) => present(book, req.user, byBook.get(String(book._id)), lockedFor(book, req.user, purchased))),
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

const uploadKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid upload key');

const createSchema = z.object({
  uploadKey: uploadKey.optional(),
  title: z.string().trim().max(300).optional(),
  author: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  language: z.string().trim().max(20).optional(),
  tags: z.string().max(500).optional(),
  category: objectId.or(z.literal('')).optional(),
});

async function checkCategory(id) {
  if (id && !(await Category.exists({ _id: id }))) throw badRequest('That category no longer exists. Pick another one.');
  return id || undefined;
}

// No category chosen at upload: let A-Read work it out from the book, if it's confident.
async function pickCategory(book) {
  const categories = await Category.find();
  if (!categories.length) return;
  try {
    const { classify } = await buildClassifier(categories);
    const { category } = classify(book, book.textProfile);
    if (!category) return;
    book.category = category.id;
    book.categorySource = 'auto';
    await book.save();
  } catch (err) {
    console.warn(`Could not pick a category for book ${book._id}: ${err.message}`);
  }
}

const findUploads = (user, keys) =>
  Book.find({ uploadedBy: user._id, uploadKey: { $in: keys } })
    .select('+uploadKey')
    .populate('uploadedBy', 'name')
    .populate('category', 'name slug');

const isDuplicateUpload = (err) => err?.code === 11000 && Boolean(err.keyPattern?.uploadKey);

router.post('/', signedIn, mayUpload, uploadBook, validate(createSchema), async (req, res) => {
  const { uploadKey: key } = req.valid.body;
  // The same upload sent again (the page reloaded before our answer arrived): it's already in the
  // library, so hand that book back instead of adding it twice.
  const [already] = key ? await findUploads(req.user, [key]) : [];
  if (already) return res.json({ book: present(already, req.user) });

  const fields = { ...req.valid.body, category: await checkCategory(req.valid.body.category) };
  let book;
  try {
    book = await createBook({ user: req.user, files: req.files, fields });
  } catch (err) {
    // Both copies arrived at once and the other one was saved first.
    const [first] = isDuplicateUpload(err) ? await findUploads(req.user, [key]) : [];
    if (!first) throw err;
    return res.json({ book: present(first, req.user) });
  }
  if (!book.category) await pickCategory(book);
  await book.populate([{ path: 'uploadedBy', select: 'name' }, { path: 'category', select: 'name slug' }]);
  announce(bookPages(book));
  res.status(201).json({ book: present(book, req.user) });
});

// After a reload the upload page can't tell whether its last uploads reached the library; it asks
// here (by upload key) before sending anything again.
const uploadsSchema = z.object({ keys: z.string().max(4000) });

router.get('/uploads', signedIn, validate(uploadsSchema, 'query'), async (req, res) => {
  const keys = [...new Set(req.valid.query.keys.split(','))].filter((k) => uploadKey.safeParse(k).success).slice(0, 50);
  const books = keys.length ? await findUploads(req.user, keys) : [];
  res.json({ books: Object.fromEntries(books.map((book) => [book.uploadKey, present(book, req.user)])) });
});

router.get('/:id', async (req, res) => {
  const book = await findBook(req.params.id);
  const [progress, assignment, locked] = await Promise.all([
    req.user ? Progress.findOne({ user: req.user._id, book: book._id }) : null,
    req.user ? Assignment.findOne({ book: book._id, $or: [{ everyone: true }, { users: req.user._id }] }).sort({ dueDate: 1 }) : null,
    lockedSectionsFor(book, req.user),
  ]);
  res.json({
    book: {
      ...present(book, req.user, progress, locked),
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
  // null or '' takes the book out of its category.
  category: objectId.or(z.literal('')).nullable().optional(),
});

router.patch('/:id', signedIn, validate(updateSchema), async (req, res) => {
  const book = await findEditableBook(req);
  const { tags, category, ...fields } = req.valid.body;
  const before = bookPages(book);
  book.set(fields);
  if (tags !== undefined) book.tags = parseTags(tags);
  if (category !== undefined) {
    book.category = await checkCategory(category);
    book.categorySource = book.category ? 'manual' : undefined;
  }
  const announced = book.isModified('title') || book.isModified('author') || book.isModified('description');
  await book.save();
  await book.populate('category', 'name slug');
  // Authors who were dropped from the line lose a book too.
  if (announced) announce([...new Set([...before, ...bookPages(book)])]);
  res.json({ book: present(book, req.user) });
});

router.delete('/:id', signedIn, async (req, res) => {
  const book = await findEditableBook(req);
  await deleteBook(book);
  announce(bookPages(book));
  res.status(204).end();
});

router.put('/:id/cover', signedIn, uploadCover, async (req, res) => {
  const book = await findEditableBook(req);
  await replaceCover(book, req.file);
  res.json({ book: present(book, req.user) });
});

// More by the same authors, and books like this one (same category or shared tags, best rated
// first), for the book's page. Public, like the rest of the catalogue.
router.get('/:id/related', async (req, res) => {
  const book = await findBook(req.params.id);
  const slugs = book.authors.map((a) => a.slug);
  const byAuthor = slugs.length
    ? await Book.find({ _id: { $ne: book._id }, 'authors.slug': { $in: slugs } })
        .select('-toc -description')
        .sort({ createdAt: -1 })
        .limit(12)
        .populate('category', 'name slug')
    : [];

  const like = [];
  if (book.category) like.push({ category: book.category._id });
  if (book.tags.length) like.push({ tags: { $in: [...book.tags] } });
  let similar = [];
  if (like.length) {
    const rows = await Book.aggregate([
      { $match: { _id: { $nin: [book._id, ...byAuthor.map((b) => b._id)] }, $or: like } },
      {
        $addFields: {
          closeness: {
            $add: [
              { $size: { $setIntersection: [{ $ifNull: ['$tags', []] }, [...book.tags]] } },
              book.category ? { $cond: [{ $eq: ['$category', book.category._id] }, 2, 0] } : 0,
            ],
          },
        },
      },
      { $sort: { closeness: -1, 'rating.score': -1, createdAt: -1 } },
      { $limit: 12 },
      { $project: { _id: 1 } },
    ]);
    const found = await Book.find({ _id: { $in: rows.map((r) => r._id) } })
      .select('-toc -description')
      .populate('category', 'name slug');
    const order = new Map(rows.map((r, i) => [String(r._id), i]));
    similar = found.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
  }

  const purchased = await purchasedBookIds(req.user, [...byAuthor, ...similar]);
  const show = (b) => present(b, req.user, null, lockedFor(b, req.user, purchased));
  res.json({ byAuthor: byAuthor.map(show), similar: similar.map(show) });
});

// --- Text ------------------------------------------------------------------------------------

router.get('/:id/sections', async (req, res) => {
  const book = await findBook(req.params.id);
  const [sections, locked] = await Promise.all([
    Section.find({ book: book._id })
      .sort({ index: 1 })
      .select('index title href wordCount sentenceCount narration.duration narration.voice')
      .lean(),
    lockedSectionsFor(book, req.user),
  ]);
  res.json({
    sections: sections.map((s) => ({
      index: s.index,
      title: s.title,
      href: s.href,
      wordCount: s.wordCount,
      sentenceCount: s.sentenceCount,
      narrationDuration: s.narration?.duration ?? null,
      locked: locked.has(s.index),
    })),
  });
});

const sectionJson = ({ _id, __v, book: _book, sentences, paragraphStarts, ...rest }) => ({
  ...rest,
  paragraphs: unpackParagraphs(sentences, paragraphStarts),
});

// Every section's full text in one response, used to save a book for offline reading.
// Chapters this reader hasn't unlocked come without their text or audio.
router.get('/:id/offline', signedIn, async (req, res) => {
  const book = await findBook(req.params.id);
  const [sections, locked] = await Promise.all([Section.find({ book: book._id }).sort({ index: 1 }).lean(), lockedSectionsFor(book, req.user)]);
  res.json({
    sections: sections.map((s) =>
      locked.has(s.index) ? { ...sectionJson({ ...s, sentences: [], paragraphStarts: [], narration: undefined }), locked: true } : sectionJson(s),
    ),
  });
});

router.get('/:id/sections/:index', signedIn, async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) throw badRequest('Invalid section number');
  const book = await Book.findById(req.params.id).select('uploadedBy premium');
  if (!book) throw notFound('Book not found');
  if ((await lockedSectionsFor(book, req.user)).has(index)) throw lockedError(book);
  const section = await Section.findOne({ book: book._id, index }).lean();
  if (!section) throw notFound('Section not found');
  res.json({ section: sectionJson(section) });
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
