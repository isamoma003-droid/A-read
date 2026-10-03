import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAdmin, requireSuperAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Assignment } from '../models/Assignment.js';
import { Book } from '../models/Book.js';
import { Bookmark } from '../models/Bookmark.js';
import { Payment } from '../models/Payment.js';
import { Progress } from '../models/Progress.js';
import { Review } from '../models/Review.js';
import { ROLES, User, isSuperAdmin } from '../models/User.js';
import { deleteBook } from '../services/books.js';
import { activePassHolders } from '../services/pass.js';
import { secureBookFiles } from '../services/premium.js';
import { refreshRating } from '../services/reviews.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/stats', async (_req, res) => {
  const [users, admins, books, formats, storage, narrated, audiobooks, recentUsers, premium] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: { $in: ['admin', 'superadmin'] } }),
    Book.countDocuments(),
    Book.aggregate([{ $group: { _id: '$format', count: { $sum: 1 } } }]),
    Book.find().select('file.bytes audiobook.bytes wordCount').lean(),
    Book.countDocuments({ 'narration.status': { $in: ['ready', 'partial'] } }),
    Book.countDocuments({ 'audiobook.url': { $exists: true } }),
    User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }),
    Book.countDocuments({ 'premium.enabled': true }),
  ]);
  const totals = storage.reduce(
    (sum, b) => ({
      files: sum.files + (b.file?.bytes || 0),
      audio: sum.audio + (b.audiobook?.bytes || 0),
      words: sum.words + (b.wordCount || 0),
    }),
    { files: 0, audio: 0, words: 0 },
  );
  res.json({
    users,
    admins,
    newUsersThisWeek: recentUsers,
    books,
    formats: Object.fromEntries(formats.map((f) => [f._id, f.count])),
    narrated,
    audiobooks,
    premium,
    storageBytes: totals.files + totals.audio,
    words: totals.words,
  });
});

const listSchema = z.object({ q: z.string().trim().max(100).optional() });

router.get('/users', validate(listSchema, 'query'), async (req, res) => {
  const { q } = req.valid.query;
  const filter = q ? { $or: [{ name: new RegExp(escapeRegex(q), 'i') }, { email: new RegExp(escapeRegex(q), 'i') }] } : {};
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);
  const counts = await Book.aggregate([
    { $match: { uploadedBy: { $in: users.map((u) => u._id) } } },
    { $group: { _id: '$uploadedBy', count: { $sum: 1 } } },
  ]);
  const byUser = new Map(counts.map((c) => [String(c._id), c.count]));
  res.json({ users: users.map((u) => ({ ...u.toPublic(), books: byUser.get(String(u._id)) || 0 })) });
});

const roleSchema = z.object({ role: z.enum(ROLES) });

// Only super admins give or take away roles (including making other super admins).
router.patch('/users/:id', requireSuperAdmin, validate(roleSchema), async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw badRequest("You can't change your own role");
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  user.role = req.valid.body.role;
  await user.save();
  res.json({ user: user.toPublic() });
});

// Removes an account, its progress and bookmarks. ?deleteBooks=true also deletes their uploads;
// otherwise their books stay in the library.
router.delete('/users/:id', async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw badRequest("You can't delete your own account here");
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  if (user.role !== 'user' && !isSuperAdmin(req.user)) throw forbidden('Only a super admin can remove an admin');
  if (req.query.deleteBooks === 'true') {
    for (const book of await Book.find({ uploadedBy: user._id })) await deleteBook(book);
  }
  const reviewed = await Review.distinct('book', { user: user._id });
  await Promise.all([
    Progress.deleteMany({ user: user._id }),
    Bookmark.deleteMany({ user: user._id }),
    Review.deleteMany({ user: user._id }),
    Assignment.updateMany({ users: user._id }, { $pull: { users: user._id } }),
  ]);
  await Promise.all(reviewed.map((bookId) => refreshRating(bookId)));
  await user.deleteOne();
  res.status(204).end();
});

// --- Premium books ---------------------------------------------------------------------------

const premiumJson = (premium) => ({
  enabled: Boolean(premium?.enabled),
  price: premium?.price ?? null,
  lockedSections: premium?.lockedSections ?? [],
  updatedAt: premium?.updatedAt ?? null,
});

// Every book that is (or was) premium, with what it has sold.
router.get('/premium', async (_req, res) => {
  const books = await Book.find({ premium: { $exists: true } })
    .select('title author cover format sectionCount premium')
    .collation({ locale: 'en' })
    .sort({ 'premium.enabled': -1, title: 1 });
  const sales = await Payment.aggregate([
    { $match: { book: { $in: books.map((b) => b._id) }, status: 'paid' } },
    { $group: { _id: '$book', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const byBook = new Map(sales.map((s) => [String(s._id), s]));
  res.json({
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      cover: b.cover,
      format: b.format,
      sectionCount: b.sectionCount,
      premium: premiumJson(b.premium),
      sales: { amount: byBook.get(b.id)?.amount || 0, count: byBook.get(b.id)?.count || 0 },
    })),
  });
});

router.get('/books/:id/premium', async (req, res) => {
  const book = await Book.findById(req.params.id).select('premium');
  if (!book) throw notFound('Book not found');
  res.json({ premium: premiumJson(book.premium) });
});

const price = z
  .number()
  .int('Use a whole number of shillings')
  .min(env.mpesa.minAmount, `The lowest price is KES ${env.mpesa.minAmount}`)
  .max(env.mpesa.maxAmount, `The highest price is KES ${env.mpesa.maxAmount.toLocaleString('en-KE')}`);

const premiumSchema = z.object({
  enabled: z.boolean(),
  price: price.optional(),
  // Section indexes (0-based) to lock until the reader pays.
  lockedSections: z.array(z.number().int().min(0)).max(50_000).optional(),
});

// Makes a book premium (or free again). Readers who already paid keep access either way.
router.put('/books/:id/premium', validate(premiumSchema), async (req, res) => {
  const book = await Book.findById(req.params.id);
  if (!book) throw notFound('Book not found');
  const { enabled, price = book.premium?.price, lockedSections = book.premium?.lockedSections ?? [] } = req.valid.body;
  const locked = [...new Set(lockedSections)].sort((a, b) => a - b);
  const missing = locked.find((i) => i >= book.sectionCount);
  if (missing !== undefined) throw badRequest(`This book has ${book.sectionCount} parts, so part ${missing + 1} can't be locked`);
  if (enabled && !price) throw badRequest('Set the price readers pay to unlock this book');
  if (enabled && !locked.length) throw badRequest('Choose at least one chapter to lock');
  // Older PDFs have a cover drawn from the PDF itself, and that image link can show any page.
  if (enabled && book.coverSource === 'pdf') {
    throw conflict("This book's cover is drawn from the PDF itself, which would show the locked pages. Upload a cover image first, then make it premium.");
  }

  const previous = book.premium?.toObject();
  book.premium = { enabled, price, lockedSections: locked, updatedBy: req.user._id, updatedAt: new Date() };
  await book.validate();
  if (enabled) await secureBookFiles(book, previous);
  await book.save();
  res.json({ premium: premiumJson(book.premium) });
});

export default router;

// --- Featured shelf --------------------------------------------------------------------------

const featureSchema = z.object({ days: z.number().int().min(0).max(366, 'Feature a book for at most a year') });

// Puts a book on the home page's Featured shelf for `days` days from now (0 takes it off).
router.put('/books/:id/featured', validate(featureSchema), async (req, res) => {
  const { days } = req.valid.body;
  const book = await Book.findByIdAndUpdate(
    req.params.id,
    days ? { $set: { featuredUntil: new Date(Date.now() + days * 24 * 60 * 60 * 1000) } } : { $unset: { featuredUntil: '' } },
    { returnDocument: 'after', timestamps: false },
  ).select('featuredUntil');
  if (!book) throw notFound('Book not found');
  res.json({ featuredUntil: book.featuredUntil ?? null });
});

// --- Premium Pass ----------------------------------------------------------------------------

async function passJson(settings) {
  const [[sales], holders] = await Promise.all([
    Payment.aggregate([{ $match: { purpose: 'pass', status: 'paid' } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    activePassHolders(),
  ]);
  return {
    enabled: Boolean(settings.pass?.enabled),
    price: settings.pass?.price ?? null,
    days: settings.pass?.days ?? 30,
    sales: { amount: sales?.amount ?? 0, count: sales?.count ?? 0 },
    // Readers whose pass hasn't run out.
    holders,
  };
}

router.get('/pass', async (_req, res) => {
  res.json({ pass: await passJson(await getSettings()) });
});

const passSchema = z.object({
  enabled: z.boolean(),
  price: price.optional(),
  days: z.number().int('Use a whole number of days').min(1, 'A pass lasts at least a day').max(366, 'A pass lasts at most a year').optional(),
});

// Puts the Premium Pass on sale (or stops selling it). Passes already bought last their time either way.
router.put('/pass', validate(passSchema), async (req, res) => {
  const current = (await getSettings()).pass;
  const { enabled, price: amount = current?.price, days = current?.days ?? 30 } = req.valid.body;
  if (enabled && !amount) throw badRequest('Set the price of the Premium Pass');
  const settings = await updateSettings({ pass: { enabled, price: amount, days } }, req.user);
  res.json({ pass: await passJson(settings) });
});
