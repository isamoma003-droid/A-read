import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

// A reader's star rating (1-5) of a book, with optional words. One per reader and book.
const reviewSchema = new Schema(
  {
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, trim: true, maxlength: 2000, default: '' },
  },
  { timestamps: true },
);

reviewSchema.index({ book: 1, user: 1 }, { unique: true });
reviewSchema.index({ book: 1, updatedAt: -1 });

export const Review = mongoose.model('Review', reviewSchema);
