import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAdmin } from '../middleware/admin.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Payment } from '../models/Payment.js';
import { Promotion } from '../models/Promotion.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { inDailyWindow, minutesInZone } from '../utils/time.js';

const router = Router();

// live | scheduled | ended | paused | off-hours (inside the dates but outside the daily hours).
export function promotionState(promotion, now = new Date()) {
  if (promotion.paused) return 'paused';
  if (now < promotion.startsAt) return 'scheduled';
  if (now >= promotion.endsAt) return 'ended';
  if (!inDailyWindow(promotion.dailyFrom, promotion.dailyTo, minutesInZone(now, env.timeZone))) return 'off-hours';
  return 'live';
}

const PUBLIC_FIELDS = ['title', 'message', 'buttonLabel', 'amounts', 'autoCloseSeconds', 'frequency', 'delaySeconds', 'endsAt', 'updatedAt'];

// The popup to show this visitor right now, if any. Guests and readers get different audiences.
router.get('/active', optionalAuth, async (req, res) => {
  const now = new Date();
  const candidates = await Promotion.find({
    paused: false,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
    audience: { $in: ['everyone', req.user ? 'users' : 'guests'] },
  }).sort({ startsAt: -1 });
  const promotion = candidates.find((p) => promotionState(p, now) === 'live');
  res.json({
    promotion: promotion ? { id: promotion.id, ...Object.fromEntries(PUBLIC_FIELDS.map((f) => [f, promotion[f]])) } : null,
  });
});

// --- Admin ---------------------------------------------------------------------------------

router.use(requireAuth, requireAdmin);

router.get('/', async (_req, res) => {
  const promotions = await Promotion.find().sort({ startsAt: -1 }).limit(200);
  const totals = await Payment.aggregate([
    { $match: { promotion: { $in: promotions.map((p) => p._id) }, status: 'paid' } },
    { $group: { _id: '$promotion', raised: { $sum: '$amount' }, payments: { $sum: 1 } } },
  ]);
  const byPromotion = new Map(totals.map((t) => [String(t._id), t]));
  const now = new Date();
  res.json({
    promotions: promotions.map((p) => ({
      ...p.toJSON(),
      state: promotionState(p, now),
      raised: byPromotion.get(p.id)?.raised || 0,
      payments: byPromotion.get(p.id)?.payments || 0,
    })),
    timeZone: env.timeZone,
  });
});

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour) for daily hours')
  .nullable()
  .optional();

const fields = {
  title: z.string().trim().min(1, 'Give the popup a title').max(120),
  message: z.string().trim().max(1000),
  buttonLabel: z.string().trim().min(1).max(40),
  amounts: z.array(z.number().int().min(env.mpesa.minAmount).max(env.mpesa.maxAmount)).max(6),
  purpose: z.string().trim().regex(/^[a-z0-9-]{1,40}$/, 'Purpose must be lowercase letters, numbers or dashes'),
  audience: z.enum(['everyone', 'users', 'guests']),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  dailyFrom: time,
  dailyTo: time,
  autoCloseSeconds: z.number().int().min(0).max(600),
  frequency: z.enum(['visit', 'session', 'day', 'once']),
  delaySeconds: z.number().int().min(0).max(300),
  paused: z.boolean(),
};

const createSchema = z.object({
  ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, ['title', 'startsAt', 'endsAt'].includes(k) ? v : v.optional()])),
});
const updateSchema = createSchema.partial();

function apply(promotion, body) {
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    promotion[key] = value === null ? undefined : value;
  }
  if (promotion.endsAt <= promotion.startsAt) throw badRequest('The end time must be after the start time');
  if (Boolean(promotion.dailyFrom) !== Boolean(promotion.dailyTo)) throw badRequest('Set both daily start and end hours, or neither');
}

router.post('/', validate(createSchema), async (req, res) => {
  const promotion = new Promotion({ createdBy: req.user._id });
  apply(promotion, req.valid.body);
  await promotion.save();
  res.status(201).json({ promotion: { ...promotion.toJSON(), state: promotionState(promotion) } });
});

router.patch('/:id', validate(updateSchema), async (req, res) => {
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) throw notFound('Promotion not found');
  apply(promotion, req.valid.body);
  await promotion.save();
  res.json({ promotion: { ...promotion.toJSON(), state: promotionState(promotion) } });
});

router.delete('/:id', async (req, res) => {
  const result = await Promotion.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) throw notFound('Promotion not found');
  res.status(204).end();
});

export default router;
