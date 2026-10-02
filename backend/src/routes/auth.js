import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { User, roleRank } from '../models/User.js';
import { emailEnabled, sendVerificationEmail } from '../services/email.js';
import { getSettings } from '../services/settings.js';
import { HttpError, badRequest, conflict, forbidden, unauthorized } from '../utils/httpError.js';

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

// The role SUPER_ADMIN_EMAILS / ADMIN_EMAILS give this address.
const roleFor = (address) =>
  env.superAdminEmails.includes(address) ? 'superadmin' : env.adminEmails.includes(address) ? 'admin' : 'user';

// Raises the user to their configured role. Never lowers it: roles given in the admin panel stay.
function applyConfiguredRole(user, address) {
  if (roleRank(roleFor(address)) <= roleRank(user.role)) return false;
  user.role = roleFor(address);
  return true;
}

// A super admin can close sign-ups; the people listed in the settings can always join.
async function assertSignupsOpen(address) {
  if (roleFor(address) === 'user' && !(await getSettings()).signupsOpen) {
    throw forbidden('New sign-ups are closed right now. Please check back later.');
  }
}
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

function session(user) {
  return { token: signToken(user), user: user.toPublic() };
}

// Gives the user a fresh confirmation link (only the hash is stored) and emails it.
async function sendVerification(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  user.verifyTokenHash = hashToken(token);
  user.verifyTokenExpires = new Date(Date.now() + VERIFY_TTL_MS);
  await user.save();
  await sendVerificationEmail(user, token);
}

// Tells the frontend which sign-in options this server offers.
router.get('/config', (_req, res) => {
  res.json({ googleClientId: env.googleClientId || null, emailVerification: emailEnabled() });
});

router.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
  const { name, email: address, password } = req.valid.body;
  let user = await User.findOne({ email: address });
  if (user && user.isVerified()) throw conflict('An account with that email already exists. Log in instead.');
  if (!user) await assertSignupsOpen(address);

  // An unconfirmed sign-up can be repeated (e.g. after a typo in the password or a lost email).
  user ??= new User({ email: address, role: roleFor(address) });
  user.name = name;
  await user.setPassword(password);

  if (!emailEnabled()) {
    user.emailVerified = true;
    await user.save();
    return res.status(201).json(session(user));
  }

  user.emailVerified = false;
  try {
    await sendVerification(user);
  } catch (err) {
    console.error('Could not send confirmation email:', err.message);
    throw new HttpError(502, "We couldn't send the confirmation email. Check the address and try again.");
  }
  res.status(201).json({ pending: true, email: address });
});

router.post('/resend-verification', authLimiter, validate(z.object({ email })), async (req, res) => {
  const user = await User.findOne({ email: req.valid.body.email });
  // Same answer whether or not the account exists, so this can't be used to probe emails.
  if (user && !user.isVerified() && emailEnabled()) {
    await sendVerification(user).catch((err) => console.error('Could not resend confirmation email:', err.message));
  }
  res.json({ ok: true });
});

router.post('/verify-email', authLimiter, validate(z.object({ token: z.string().min(10).max(200) })), async (req, res) => {
  const user = await User.findOne({
    verifyTokenHash: hashToken(req.valid.body.token),
    verifyTokenExpires: { $gt: new Date() },
  });
  if (!user) throw badRequest('This confirmation link is invalid or has expired. Request a new one from the sign-in page.');
  user.emailVerified = true;
  user.verifyTokenHash = undefined;
  user.verifyTokenExpires = undefined;
  await user.save();
  res.json(session(user));
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email: address, password } = req.valid.body;
  const user = await User.findOne({ email: address }).select('+passwordHash');
  if (user && !user.passwordHash && user.googleId) {
    throw badRequest('This account uses Google sign-in. Use "Continue with Google".');
  }
  if (!user || !(await user.checkPassword(password))) throw unauthorized('Wrong email or password');
  if (!user.isVerified()) {
    const err = new HttpError(403, 'Confirm your email first. We sent you a link when you signed up.');
    err.details = { code: 'EMAIL_NOT_VERIFIED', email: address };
    throw err;
  }

  // Pick up ADMIN_EMAILS / SUPER_ADMIN_EMAILS changes on the next login.
  if (applyConfiguredRole(user, address)) await user.save();
  res.json(session(user));
});

// --- Google -------------------------------------------------------------------------------

let googleClient;
let verifyGoogleToken = async (credential) => {
  googleClient ??= new OAuth2Client(env.googleClientId);
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.googleClientId });
  return ticket.getPayload();
};

// Lets tests replace Google's token check.
export function setGoogleVerifier(fake) {
  verifyGoogleToken = fake;
}

router.post('/google', authLimiter, validate(z.object({ credential: z.string().min(20).max(5000) })), async (req, res) => {
  if (!env.googleClientId) throw badRequest('Google sign-in is not configured on this server (GOOGLE_CLIENT_ID)');
  let profile;
  try {
    profile = await verifyGoogleToken(req.valid.body.credential);
  } catch {
    throw unauthorized('Google sign-in failed. Please try again.');
  }
  if (!profile?.email || !profile.email_verified) throw unauthorized('Your Google account email is not verified');

  const address = profile.email.toLowerCase();
  let user = (await User.findOne({ googleId: profile.sub })) || (await User.findOne({ email: address }));
  if (!user) {
    await assertSignupsOpen(address);
    user = new User({ email: address, name: (profile.name || address.split('@')[0]).slice(0, 80), role: roleFor(address) });
  }
  // Google has confirmed the address, which also confirms an unverified email sign-up.
  user.googleId = profile.sub;
  user.emailVerified = true;
  applyConfiguredRole(user, address);
  await user.save();
  res.json(session(user));
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

export default router;
