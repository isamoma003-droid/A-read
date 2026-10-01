import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Book } from '../models/Book.js';
import { Bookmark } from '../models/Bookmark.js';
import { Progress } from '../models/Progress.js';
import { User } from '../models/User.js';
import { deleteBook } from '../services/books.js';
import { badRequest, notFound } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/stats', async (_req, res) => {
  const [users, admins, books, formats, storage, narrated, audiobooks, recentUsers] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    Book.countDocuments(),
    Book.aggregate([{ $group: { _id: '$format', count: { $sum: 1 } } }]),
    Book.find().select('file.bytes audiobook.bytes wordCount').lean(),
    Book.countDocuments({ 'narration.status': { $in: ['ready', 'partial'] } }),
    Book.countDocuments({ 'audiobook.url': { $exists: true } }),
    User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }),
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

const roleSchema = z.object({ role: z.enum(['user', 'admin']) });

router.patch('/users/:id', validate(roleSchema), async (req, res) => {
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
  if (req.query.deleteBooks === 'true') {
    for (const book of await Book.find({ uploadedBy: user._id })) await deleteBook(book);
  }
  await Promise.all([Progress.deleteMany({ user: user._id }), Bookmark.deleteMany({ user: user._id })]);
  await user.deleteOne();
  res.status(204).end();
});

export default router;
