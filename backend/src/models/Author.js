import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

// What admins write about an author for their page (/authors/:slug). The author pages themselves
// come from the books: anyone named in a book's author line has one.
const authorSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    bio: { type: String, trim: true, maxlength: 3000, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Author = mongoose.model('Author', authorSchema);
