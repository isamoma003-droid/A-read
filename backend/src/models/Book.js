import mongoose from '../config/mongoose.js';
import { isAdmin } from './User.js';

const { Schema } = mongoose;

// A file stored in Cloudinary.
const assetSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    resourceType: { type: String, enum: ['image', 'video', 'raw'], required: true },
    bytes: Number,
    format: String,
    // Set when a large file is stored in pieces; the reader joins them in order.
    parts: {
      type: [new Schema({ url: String, publicId: String, bytes: Number }, { _id: false })],
      default: undefined,
    },
  },
  { _id: false },
);

const audiobookSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    resourceType: { type: String, default: 'video' },
    bytes: Number,
    format: String,
    duration: Number,
    originalName: String,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// Summary of the Google Cloud TTS narration job. The audio itself lives on each Section.
const narrationSchema = new Schema(
  {
    status: {
      type: String,
      enum: ['none', 'generating', 'ready', 'partial', 'failed'],
      default: 'none',
    },
    voice: String,
    languageCode: String,
    completedSections: { type: Number, default: 0 },
    totalSections: { type: Number, default: 0 },
    error: String,
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    startedAt: Date,
    finishedAt: Date,
  },
  { _id: false },
);

// Set by admins: readers pay `price` (KES, by M-Pesa) once to open the `lockedSections`.
// Turning premium off keeps the price and chapters so it can be turned back on.
const premiumSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    price: { type: Number, min: 1 },
    lockedSections: { type: [Number], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedAt: Date,
  },
  { _id: false },
);

const bookSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    author: { type: String, trim: true, maxlength: 200, default: '' },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    language: { type: String, trim: true, maxlength: 20, default: '' },
    tags: { type: [String], default: [] },
    category: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    // 'auto' when A-Read picked the category from the book itself; 'manual' (or unset, for books
    // filed before automatic picks existed) when a person chose it.
    categorySource: { type: String, enum: ['manual', 'auto'] },
    // A summary of the book's words used to work out its category (services/categorize.js).
    textProfile: { type: Schema.Types.Mixed, select: false },
    premium: premiumSchema,
    format: { type: String, enum: ['pdf', 'epub', 'txt'], required: true },
    originalName: String,
    file: { type: assetSchema, required: true },
    cover: assetSchema,
    coverSource: { type: String, enum: ['none', 'pdf', 'epub', 'upload'], default: 'none' },
    toc: {
      type: [
        new Schema(
          { title: String, sectionIndex: Number, depth: { type: Number, default: 0 } },
          { _id: false },
        ),
      ],
      default: [],
    },
    sectionCount: { type: Number, default: 0 },
    wordCount: { type: Number, default: 0 },
    charCount: { type: Number, default: 0 },
    audiobook: audiobookSchema,
    narration: { type: narrationSchema, default: () => ({}) },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Lower-cased copies used for case-insensitive sorting.
    sortTitle: { type: String, select: false },
    sortAuthor: { type: String, select: false },
  },
  { timestamps: true },
);

bookSchema.index({ createdAt: -1 });
bookSchema.index({ sortTitle: 1 });
bookSchema.index({ sortAuthor: 1, sortTitle: 1 });

bookSchema.pre('validate', function setSortKeys() {
  this.sortTitle = (this.title || '').toLowerCase().replace(/^(the|a|an)\s+/, '');
  this.sortAuthor = (this.author || '').toLowerCase();
});
bookSchema.index({ tags: 1 });

bookSchema.methods.canEdit = function canEdit(user) {
  if (!user) return false;
  return isAdmin(user) || String(this.uploadedBy?._id ?? this.uploadedBy) === String(user._id);
};

export const Book = mongoose.model('Book', bookSchema);
