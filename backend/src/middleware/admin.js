import { forbidden } from '../utils/httpError.js';

// Use after requireAuth.
export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') throw forbidden('Admins only');
  next();
}
