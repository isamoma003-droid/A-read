import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

const progressSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    sectionIndex: { type: Number, default: 0, min: 0 },
    sentenceIndex: { type: Number, default: 0, min: 0 },
    epubCfi: String,
    audiobookTime: { type: Number, default: 0, min: 0 },
    view: { type: String, enum: ['text', 'page'], default: 'text' },
    percent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true },
);

progressSchema.index({ user: 1, book: 1 }, { unique: true });
progressSchema.index({ user: 1, updatedAt: -1 });

export const Progress = mongoose.model('Progress', progressSchema);
