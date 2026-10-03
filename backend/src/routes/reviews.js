import { Router } from 'express';
import { z } from 'zod';
import mongoose from '../config/mongoose.js';
import { requireAdmin } from '../middleware/admin.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Book } from '../models/Book.js';
import { Progress } from '../models/Progress.js';
import { Review } from '../models/Review.js';
import { ratingDistribution, refreshRating } from '../services/reviews.js';
import { forbidden, notFound } from '../utils/httpError.js';

// Ratings and reviews of one book: /api/books/:id/reviews.
const router = Router({ mergeParams: true });

async function findBook(req) {
  const book = mongoose.isValidObjectId(req.params.id) ? await Book.findById(req.params.id).select('uploadedBy rating') : null;
  if (!book) throw notFound('Book not found');
  return book;
}

// Whoever uploaded a book doesn't rate it, so ratings stay the readers' own.
const isUploader = (book, user) => String(book.uploadedBy) === String(user._id);

const userId = (review) => String(review.user?._id ?? review.user);

function reviewJson(review, viewer, finishedBy) {
  return {
    id: review.id,
    rating: review.rating,
    text: review.text,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    user: { name: review.user?.name ?? 'A reader' },
    mine: Boolean(viewer) && userId(review) === String(viewer._id),
    // The reviewer read to the end (or marked the book finished).
    finished: finishedBy.has(userId(review)),
  };
}

async function finishedReaders(bookId, reviews) {
  if (!reviews.length) return new Set();
  const done = await Progress.find({ book: bookId, user: { $in: reviews.map(userId) }, completedAt: { $ne: null } })
    .select('user')
    .lean();
  return new Set(done.map((p) => String(p.user)));
}

const summaryOf = async (bookId, rating) => ({
  average: rating?.average ?? null,
  count: rating?.count ?? 0,
  distribution: await ratingDistribution(bookId),
});

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// Public, like the rest of a book's page. Reviews with words are listed, newest first; ratings
// without words still count towards the stars.
router.get('/', optionalAuth, validate(listSchema, 'query'), async (req, res) => {
  const book = await findBook(req);
  const { page, limit } = req.valid.query;
  const filter = { book: book._id, text: { $ne: '' } };
  const [reviews, total, summary, mine] = await Promise.all([
    Review.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', 'name'),
    Review.countDocuments(filter),
    summaryOf(book._id, book.rating),
    req.user ? Review.findOne({ book: book._id, user: req.user._id }).populate('user', 'name') : null,
  ]);
  const finishedBy = await finishedReaders(book._id, mine ? [...reviews, mine] : reviews);
  res.json({
    summary,
    reviews: reviews.map((r) => reviewJson(r, req.user, finishedBy)),
    mine: mine ? reviewJson(mine, req.user, finishedBy) : null,
    canReview: Boolean(req.user) && !isUploader(book, req.user),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

const reviewSchema = z.object({
  rating: z.number().int('Pick from 1 to 5 stars').min(1, 'Pick from 1 to 5 stars').max(5, 'Pick from 1 to 5 stars'),
  text: z.string().trim().max(2000, 'Keep your review under 2,000 characters').default(''),
});

// Adds or changes the signed-in reader's rating and review.
router.put('/mine', requireAuth, validate(reviewSchema), async (req, res) => {
  const book = await findBook(req);
  if (isUploader(book, req.user)) throw forbidden("You can't rate a book you uploaded");
  const review = await Review.findOneAndUpdate(
    { book: book._id, user: req.user._id },
    { $set: req.valid.body },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
  ).populate('user', 'name');
  const rating = await refreshRating(book._id);
  const finishedBy = await finishedReaders(book._id, [review]);
  res.json({ review: reviewJson(review, req.user, finishedBy), summary: await summaryOf(book._id, rating) });
});

router.delete('/mine', requireAuth, async (req, res) => {
  const book = await findBook(req);
  await Review.deleteOne({ book: book._id, user: req.user._id });
  res.json({ summary: await summaryOf(book._id, await refreshRating(book._id)) });
});

// Admins remove a review that breaks the rules.
router.delete('/:reviewId', requireAuth, requireAdmin, async (req, res) => {
  const book = await findBook(req);
  const removed = mongoose.isValidObjectId(req.params.reviewId) ? await Review.findOneAndDelete({ _id: req.params.reviewId, book: book._id }) : null;
  if (!removed) throw notFound('Review not found');
  res.json({ summary: await summaryOf(book._id, await refreshRating(book._id)) });
});

export default router;
