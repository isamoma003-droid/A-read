import bcrypt from 'bcryptjs';
import mongoose from '../config/mongoose.js';

// Lowest to highest. Admins run the library; super admins also manage admins and site settings.
export const ROLES = ['user', 'admin', 'superadmin'];
export const isAdmin = (user) => user?.role === 'admin' || user?.role === 'superadmin';
export const isSuperAdmin = (user) => user?.role === 'superadmin';
export const roleRank = (role) => ROLES.indexOf(role);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Absent for accounts that only use Google sign-in.
    passwordHash: { type: String, select: false },
    googleId: { type: String, index: true, sparse: true },
    // false until the confirmation link is clicked. Accounts created before verification
    // existed have no value and count as verified.
    emailVerified: Boolean,
    verifyTokenHash: { type: String, select: false },
    verifyTokenExpires: { type: Date, select: false },
    role: { type: String, enum: ROLES, default: 'user' },
  },
  { timestamps: true },
);

userSchema.methods.setPassword = async function setPassword(password) {
  this.passwordHash = await bcrypt.hash(password, 12);
};

userSchema.methods.checkPassword = function checkPassword(password) {
  return this.passwordHash ? bcrypt.compare(password, this.passwordHash) : Promise.resolve(false);
};

userSchema.methods.isVerified = function isVerified() {
  return this.emailVerified !== false;
};

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    name: this.name,
    email: this.email,
    role: this.role,
    google: Boolean(this.googleId),
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
