import { isAdmin, isSuperAdmin } from '../models/User.js';
import { forbidden } from '../utils/httpError.js';

// Use after requireAuth. Super admins pass every admin check.
export function requireAdmin(req, _res, next) {
  if (!isAdmin(req.user)) throw forbidden('Admins only');
  next();
}

export function requireSuperAdmin(req, _res, next) {
  if (!isSuperAdmin(req.user)) throw forbidden('Only a super admin can do that');
  next();
}
