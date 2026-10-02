import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Book } from '../models/Book.js';
import { Progress } from '../models/Progress.js';
import { notFound } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);

function shelfBook(book) {
  const { audiobook, ...json } = book.toJSON();
  return { ...json, hasAudio: Boolean(audiobook?.url) || ['ready', 'partial'].includes(json.narration?.status) };
}

// "Continue reading": the user's most recently opened books.
router.get('/', async (req, res) => {
  const items = await Progress.find({ user: req.user._id })
    .sort({ updatedAt: -1 })
    .limit(12)
    .populate('book', 'title author cover format sectionCount narration.status audiobook.url');
  // Finished books drop off "continue reading". The shelf only needs to know a book has audio:
  // an audiobook's URL isn't sent, since a premium book's audiobook holds its locked chapters.
  res.json({
    items: items
      .filter((item) => item.book && !item.completedAt)
      .map((item) => ({
        book: shelfBook(item.book),
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
  sectionIndex: z.number().int().min(0).default(0),
  sentenceIndex: z.number().int().min(0).default(0),
  epubCfi: z.string().max(500).optional(),
  audiobookTime: z.number().min(0).optional(),
  view: z.enum(['text', 'page']).optional(),
  percent: z.number().min(0).max(100).optional(),
  // true = mark as finished, false = mark as not finished
  finished: z.boolean().optional(),
});

router.put('/:bookId', validate(progressSchema), async (req, res) => {
  const book = await Book.findById(req.params.bookId).select('_id');
  if (!book) throw notFound('Book not found');
  const { finished, ...fields } = req.valid.body;
  const update = { $set: fields };
  if (finished === true || (finished === undefined && fields.percent >= 99.5)) {
    update.$set.completedAt = new Date();
    if (finished) update.$set.percent = 100;
  } else if (finished === false) {
    update.$unset = { completedAt: 1 };
  }
  // Reaching the end once is enough; keep the first completion date.
  const existing = await Progress.findOne({ user: req.user._id, book: book._id }).select('completedAt');
  if (existing?.completedAt && finished !== false) delete update.$set.completedAt;
  const progress = await Progress.findOneAndUpdate(
    { user: req.user._id, book: book._id },
    update,
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  res.json({ progress });
});

export default router;
