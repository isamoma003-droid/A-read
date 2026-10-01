import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

const bookmarkSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    sectionIndex: { type: Number, required: true, min: 0 },
    sentenceIndex: { type: Number, default: 0, min: 0 },
    epubCfi: String,
    audiobookTime: Number,
    label: { type: String, trim: true, maxlength: 200, default: '' },
    note: { type: String, trim: true, maxlength: 2000, default: '' },
    snippet: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true },
);

bookmarkSchema.index({ user: 1, book: 1, createdAt: -1 });

export const Bookmark = mongoose.model('Bookmark', bookmarkSchema);
