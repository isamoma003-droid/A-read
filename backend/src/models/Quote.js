import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

// A line from a book, shown in the quote popup when the app opens. Admins manage the list.
const quoteSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    bookTitle: { type: String, required: true, trim: true, maxlength: 300 },
    author: { type: String, trim: true, maxlength: 200, default: '' },
    // Optional link to the book in this library ("Read this book").
    book: { type: Schema.Types.ObjectId, ref: 'Book' },
    enabled: { type: Boolean, default: true },
    // Identifies the book, so two quotes in a row never come from the same one.
    bookKey: { type: String, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// "The Picture of Dorian Gray" and "picture of dorian gray" are the same book.
export const bookKeyOf = (title) =>
  String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');

// The same quote can't be in the list twice (it would show twice per round).
quoteSchema.index({ text: 1 }, { unique: true });

quoteSchema.pre('validate', function setBookKey() {
  this.bookKey = bookKeyOf(this.bookTitle);
});

export const Quote = mongoose.model('Quote', quoteSchema);
