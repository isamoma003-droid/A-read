import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

// "Fiction", "History", "Children"…: admins manage the list, and each book can sit in one.
const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Used in library links (/?category=fiction). Unique, so names can't repeat in another case.
    slug: { type: String, required: true, unique: true },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// "Science & Nature" -> "science-nature". Letters from any alphabet are kept.
export function slugify(name) {
  // Lower-case after normalising: NFKD turns letters like "𝐅" or "℃" into capitals.
  return String(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

categorySchema.pre('validate', function setSlug() {
  if (this.isModified('name') || !this.slug) this.slug = slugify(this.name);
});

export const Category = mongoose.model('Category', categorySchema);
