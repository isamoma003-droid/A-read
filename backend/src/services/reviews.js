import mongoose from '../config/mongoose.js';
import { Book } from '../models/Book.js';
import { Review } from '../models/Review.js';

// "Top rated" ranks by this score rather than the plain average, so one five-star review doesn't
// outrank a hundred four-and-a-half-star ones: every book starts as if it had PRIOR_VOTES of
// PRIOR_STARS, and real ratings soon outweigh them.
const PRIOR_VOTES = 2;
const PRIOR_STARS = 3;

// Recounts a book's rating from its reviews and stores the summary on the book (without
// touching its updatedAt: a review isn't a change to the book, and offline copies key on it).
export async function refreshRating(bookId) {
  const [row] = await Review.aggregate([
    { $match: { book: new mongoose.Types.ObjectId(String(bookId)) } },
    { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const update = row
    ? {
        $set: {
          rating: {
            average: Math.round(row.average * 10) / 10,
            count: row.count,
            score: (row.average * row.count + PRIOR_STARS * PRIOR_VOTES) / (row.count + PRIOR_VOTES),
          },
        },
      }
    : { $unset: { rating: '' } };
  await Book.updateOne({ _id: bookId }, update, { timestamps: false });
  return row ? update.$set.rating : null;
}

// How many reviews gave each number of stars.
export async function ratingDistribution(bookId) {
  const rows = await Review.aggregate([
    { $match: { book: new mongoose.Types.ObjectId(String(bookId)) } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ]);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) counts[row._id] = row.count;
  return counts;
}
