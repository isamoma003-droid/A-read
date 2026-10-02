import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

// Site-wide settings, kept in one document and changed by super admins (Admin → System).
const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'system' },
    // false: only people listed in ADMIN_EMAILS / SUPER_ADMIN_EMAILS can create new accounts.
    signupsOpen: { type: Boolean, default: true },
    // Who can upload books.
    uploads: { type: String, enum: ['everyone', 'admins'], default: 'everyone' },
    // The book-quote popup shown when the app opens.
    quotesEnabled: { type: Boolean, default: true },
    // A notice at the top of every page (maintenance, news…). Empty shows nothing.
    announcement: { type: String, trim: true, maxlength: 300, default: '' },
    // Set once the classic quotes have been added, so deleting them all doesn't bring them back.
    quotesSeeded: { type: Boolean, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Settings = mongoose.model('Settings', settingsSchema);
