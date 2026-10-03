import mongoose from '../config/mongoose.js';
import { slugify } from '../utils/slug.js';

export { slugify };

const { Schema } = mongoose;

// "Fiction", "History", "Children"…: admins manage the list, and each book can sit in one.
const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Used in library links (/?category=fiction). Unique, so names can't repeat in another case.
    slug: { type: String, required: true, unique: true },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    // Extra words that suggest a book belongs here, used when A-Read works out categories.
    keywords: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

categorySchema.pre('validate', function setSlug() {
  if (this.isModified('name') || !this.slug) this.slug = slugify(this.name);
});

export const Category = mongoose.model('Category', categorySchema);
