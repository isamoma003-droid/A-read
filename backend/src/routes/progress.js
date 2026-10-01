import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Book } from '../models/Book.js';
import { Progress } from '../models/Progress.js';
import { notFound } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);

// "Continue reading": the user's most recently opened books.
router.get('/', async (req, res) => {
  const items = await Progress.find({ user: req.user._id })
    .sort({ updatedAt: -1 })
    .limit(12)
    .populate('book', 'title author cover format sectionCount narration.status audiobook.url');
  res.json({
    items: items
      .filter((item) => item.book)
      .map((item) => ({
        book: item.book,
        percent: item.percent,
        sectionIndex: item.sectionIndex,
        updatedAt: item.updatedAt,
      })),
  });
});

router.get('/:bookId', async (req, res) => {
  const progress = await Progress.findOne({ user: req.user._id, book: req.params.bookId });
  res.json({ progress });
});

const progressSchema = z.object({
  sectionIndex: z.number().int().min(0),
  sentenceIndex: z.number().int().min(0).default(0),
  epubCfi: z.string().max(500).optional(),
  audiobookTime: z.number().min(0).optional(),
  view: z.enum(['text', 'page']).optional(),
  percent: z.number().min(0).max(100).optional(),
});

router.put('/:bookId', validate(progressSchema), async (req, res) => {
  const book = await Book.findById(req.params.bookId).select('_id');
  if (!book) throw notFound('Book not found');
  const progress = await Progress.findOneAndUpdate(
    { user: req.user._id, book: book._id },
    { $set: req.valid.body },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({ progress });
});

export default router;
