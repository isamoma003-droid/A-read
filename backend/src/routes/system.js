import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { cloudinary } from '../config/cloudinary.js';
import { env } from '../config/env.js';
import { requireSuperAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Book } from '../models/Book.js';
import { Quote } from '../models/Quote.js';
import { User } from '../models/User.js';
import { emailEnabled } from '../services/email.js';
import { hubEnabled, hubWakeState, wakeHub } from '../services/hub.js';
import { mpesaEnabled } from '../services/mpesa.js';
import { getSettings, publicSettings, updateSettings } from '../services/settings.js';

const router = Router();

// Site settings every visitor's app needs (sign-ups open, who can upload, quotes, announcement).
router.get('/config', async (_req, res) => {
  res.json(publicSettings(await getSettings()));
});

// The app calls this each time it opens. Answering wakes this API (on hosts that sleep when
// idle), and it starts waking ISA Tech Hub so the first M-Pesa payment doesn't wait for it.
router.get('/wake', (_req, res) => {
  res.status(202).json({ ok: true, hub: wakeHub() });
});

// --- Super admin ---------------------------------------------------------------------------

router.use(requireAuth, requireSuperAdmin);

// Everything a super admin needs to see that the whole system is working.
router.get('/status', async (_req, res) => {
  const settings = await getSettings();
  const [users, admins, superAdmins, books, quotes] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ role: 'superadmin' }),
    Book.countDocuments(),
    Quote.countDocuments({ enabled: true }),
  ]);
  const storage = cloudinary.config();
  const payments = hubEnabled() ? 'hub' : mpesaEnabled() ? 'daraja' : 'off';
  res.json({
    settings: { ...publicSettings(settings), updatedAt: settings.updatedAt ?? null },
    services: [
      { id: 'database', label: 'Database (MongoDB)', ok: mongoose.connection.readyState === 1, detail: mongoose.connection.name },
      {
        id: 'storage',
        label: 'File storage (Cloudinary)',
        ok: Boolean(storage.cloud_name && storage.api_key && storage.api_secret),
        detail: storage.cloud_name ? `Cloud "${storage.cloud_name}"` : 'Set CLOUDINARY_URL',
      },
      { id: 'email', label: 'Email confirmation (Brevo)', ok: emailEnabled(), detail: emailEnabled() ? env.emailFrom : 'Off: new accounts are active right away' },
      { id: 'google', label: 'Sign in with Google', ok: Boolean(env.googleClientId), detail: env.googleClientId ? 'On' : 'Set GOOGLE_CLIENT_ID' },
      { id: 'narration', label: 'Cloud narration (Google TTS)', ok: env.googleTtsEnabled, detail: env.googleTtsEnabled ? 'On' : 'Off: readers use their device voice' },
      {
        id: 'payments',
        label: 'M-Pesa payments',
        ok: payments !== 'off',
        detail: { hub: 'Through ISA Tech Hub', daraja: 'Directly with Daraja', off: 'Not set up' }[payments],
      },
    ],
    hub: { enabled: hubEnabled(), ...hubWakeState() },
    counts: { users, admins, superAdmins, books, quotes },
  });
});

const settingsSchema = z.object({
  signupsOpen: z.boolean().optional(),
  uploads: z.enum(['everyone', 'admins']).optional(),
  quotesEnabled: z.boolean().optional(),
  announcement: z.string().trim().max(300, 'Keep the announcement under 300 characters').optional(),
});

router.put('/settings', validate(settingsSchema), async (req, res) => {
  res.json({ settings: publicSettings(await updateSettings(req.valid.body, req.user)) });
});

export default router;
