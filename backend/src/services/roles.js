import { env } from '../config/env.js';
import { User } from '../models/User.js';

// Makes the accounts listed in SUPER_ADMIN_EMAILS super admins at startup, so a new super admin
// doesn't have to sign in again first. (ADMIN_EMAILS and both lists are also applied at sign-in.)
export async function syncConfiguredRoles() {
  if (!env.superAdminEmails.length) return 0;
  const result = await User.updateMany({ email: { $in: env.superAdminEmails }, role: { $ne: 'superadmin' } }, { $set: { role: 'superadmin' } });
  return result.modifiedCount;
}

export const hasSuperAdmin = () => User.exists({ role: 'superadmin' }).then(Boolean);
