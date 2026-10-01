import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Assignment } from '../models/Assignment.js';
import { Book } from '../models/Book.js';
import { Progress } from '../models/Progress.js';
import { User } from '../models/User.js';
import { emailEnabled, sendAssignmentEmail } from '../services/email.js';
import { badRequest, notFound } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);

const BOOK_FIELDS = 'title author cover format wordCount sectionCount';

const forUser = (userId) => ({ $or: [{ everyone: true }, { users: userId }] });

function status(progress, dueDate) {
  if (progress?.completedAt) return 'finished';
  if (dueDate && new Date(dueDate) < new Date()) return 'overdue';
  return progress?.percent > 0 ? 'reading' : 'not-started';
}

// The signed-in reader's required reading, with their progress on each book.
router.get('/mine', async (req, res) => {
  const assignments = await Assignment.find(forUser(req.user._id)).populate('book', BOOK_FIELDS).sort({ dueDate: 1, createdAt: -1 });
  const live = assignments.filter((a) => a.book);
  const progress = await Progress.find({ user: req.user._id, book: { $in: live.map((a) => a.book._id) } });
  const byBook = new Map(progress.map((p) => [String(p.book), p]));
  res.json({
    assignments: live
      .map((a) => {
        const p = byBook.get(String(a.book._id));
        return {
          id: a.id,
          book: a.book,
          note: a.note,
          dueDate: a.dueDate,
          createdAt: a.createdAt,
          percent: p?.percent ?? 0,
          completedAt: p?.completedAt ?? null,
          status: status(p, a.dueDate),
        };
      })
      // Unfinished first (soonest due first), finished last.
      .sort((x, y) => (x.status === 'finished') - (y.status === 'finished')),
  });
});

// --- Admin ---------------------------------------------------------------------------------

async function assigneesOf(assignment) {
  return assignment.everyone ? User.find().select('name email role') : User.find({ _id: { $in: assignment.users } }).select('name email role');
}

router.get('/', requireAdmin, async (_req, res) => {
  const assignments = await Assignment.find().populate('book', BOOK_FIELDS).sort({ createdAt: -1 });
  const totalUsers = await User.countDocuments();
  const result = [];
  for (const a of assignments) {
    if (!a.book) continue;
    const assigned = a.everyone ? totalUsers : a.users.length;
    const filter = { book: a.book._id, completedAt: { $exists: true } };
    if (!a.everyone) filter.user = { $in: a.users };
    const finished = await Progress.countDocuments(filter);
    result.push({ id: a.id, book: a.book, note: a.note, dueDate: a.dueDate, everyone: a.everyone, assigned, finished, createdAt: a.createdAt });
  }
  res.json({ assignments: result });
});

router.get('/:id/report', requireAdmin, async (req, res) => {
  const assignment = await Assignment.findById(req.params.id).populate('book', BOOK_FIELDS);
  if (!assignment?.book) throw notFound('Assignment not found');
  const users = await assigneesOf(assignment);
  const progress = await Progress.find({ book: assignment.book._id, user: { $in: users.map((u) => u._id) } });
  const byUser = new Map(progress.map((p) => [String(p.user), p]));
  res.json({
    assignment: { id: assignment.id, book: assignment.book, dueDate: assignment.dueDate, note: assignment.note, everyone: assignment.everyone },
    readers: users
      .map((u) => {
        const p = byUser.get(String(u._id));
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          percent: p?.percent ?? 0,
          lastReadAt: p?.updatedAt ?? null,
          completedAt: p?.completedAt ?? null,
          status: status(p, assignment.dueDate),
        };
      })
      .sort((a, b) => b.percent - a.percent),
  });
});

const assignmentSchema = z.object({
  bookId: z.string().regex(/^[a-f0-9]{24}$/i, 'Pick a book'),
  note: z.string().trim().max(2000).default(''),
  dueDate: z.iso.date().or(z.iso.datetime()).nullable().optional(),
  everyone: z.boolean().default(true),
  userIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(1000).default([]),
  notify: z.boolean().default(false),
});

router.post('/', requireAdmin, validate(assignmentSchema), async (req, res) => {
  const { bookId, note, dueDate, everyone, userIds, notify } = req.valid.body;
  const book = await Book.findById(bookId).select(BOOK_FIELDS);
  if (!book) throw notFound('Book not found');
  if (!everyone && !userIds.length) throw badRequest('Choose at least one reader, or assign it to everyone');
  const users = everyone ? [] : (await User.find({ _id: { $in: userIds } }).select('_id')).map((u) => u._id);

  const assignment = await Assignment.create({ book: book._id, note, dueDate: dueDate || undefined, everyone, users, assignedBy: req.user._id });

  let emailed = 0;
  if (notify && emailEnabled()) {
    for (const user of await assigneesOf(assignment)) {
      try {
        await sendAssignmentEmail(user, { book, dueDate: assignment.dueDate, note });
        emailed++;
      } catch (err) {
        console.warn(`Assignment email to ${user.email} failed: ${err.message}`);
      }
    }
  }
  res.status(201).json({ assignment: { ...assignment.toJSON(), book }, emailed });
});

const updateSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  dueDate: z.iso.date().or(z.iso.datetime()).nullable().optional(),
});

router.patch('/:id', requireAdmin, validate(updateSchema), async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw notFound('Assignment not found');
  const { note, dueDate } = req.valid.body;
  if (note !== undefined) assignment.note = note;
  if (dueDate !== undefined) assignment.dueDate = dueDate || undefined;
  await assignment.save();
  res.json({ assignment });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const result = await Assignment.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) throw notFound('Assignment not found');
  res.status(204).end();
});

export default router;
