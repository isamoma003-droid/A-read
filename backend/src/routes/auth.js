import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { User } from '../models/User.js';
import { conflict, unauthorized } from '../utils/httpError.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again in a few minutes' },
  skip: () => env.nodeEnv === 'test',
});

const email = z.email('Enter a valid email address').trim().toLowerCase();

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});

const roleFor = (address) => (env.adminEmails.includes(address) ? 'admin' : 'user');

router.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
  const { name, email: address, password } = req.valid.body;
  if (await User.exists({ email: address })) throw conflict('An account with that email already exists');

  const user = new User({ name, email: address, role: roleFor(address) });
  await user.setPassword(password);
  await user.save();
  res.status(201).json({ token: signToken(user), user: user.toPublic() });
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email: address, password } = req.valid.body;
  const user = await User.findOne({ email: address }).select('+passwordHash');
  if (!user || !(await user.checkPassword(password))) throw unauthorized('Wrong email or password');

  // Pick up ADMIN_EMAILS changes on the next login.
  const role = roleFor(address) === 'admin' ? 'admin' : user.role;
  if (role !== user.role) {
    user.role = role;
    await user.save();
  }
  res.json({ token: signToken(user), user: user.toPublic() });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

export default router;
