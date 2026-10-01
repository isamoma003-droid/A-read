import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { unauthorized } from '../utils/httpError.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw unauthorized('Your session has expired, please log in again');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized('Account not found, please log in again');
  req.user = user;
  next();
}

// Like requireAuth, but lets guests through (req.user stays undefined).
export async function optionalAuth(req, res, next) {
  if (!req.get('authorization')) return next();
  try {
    await requireAuth(req, res, () => {});
  } catch {
    req.user = undefined;
  }
  next();
}
