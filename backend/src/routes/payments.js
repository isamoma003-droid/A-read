import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAdmin } from '../middleware/admin.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Payment } from '../models/Payment.js';
import { Promotion } from '../models/Promotion.js';
import { mpesaEnabled, normalizePhone, parseCallback, resultMessage, stkPush, stkQuery } from '../services/mpesa.js';
import { HttpError, badRequest, notFound } from '../utils/httpError.js';

const router = Router();

// Each request makes a phone buzz, so keep it tight.
const stkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please try again in a few minutes' },
  skip: () => env.nodeEnv === 'test',
});

// How long to wait for Safaricom's callback before asking Daraja ourselves, and how often.
const QUERY_AFTER_MS = 20_000;
const QUERY_EVERY_MS = 10_000;
// After this, a payment with no answer at all counts as failed (a late callback still settles it).
const GIVE_UP_MS = 5 * 60 * 1000;

router.get('/config', (_req, res) => {
  const c = env.mpesa;
  res.json({
    enabled: mpesaEnabled(),
    // For paying by hand from the M-Pesa menu.
    method: c.tillNumber ? 'till' : c.shortcode ? 'paybill' : null,
    number: c.tillNumber || c.shortcode || null,
    accountReference: c.tillNumber ? null : c.accountReference,
    minAmount: c.minAmount,
    maxAmount: c.maxAmount,
  });
});

const publicPayment = (p) => ({
  id: p.id,
  status: p.status,
  amount: p.amount,
  receipt: p.receipt || null,
  message: p.status === 'pending' ? null : resultMessage(p.resultCode, p.resultDesc),
});

function settle(payment, { resultCode, resultDesc, receipt, amount }) {
  payment.resultCode = resultCode;
  payment.resultDesc = resultDesc;
  if (resultCode === 0) {
    payment.status = 'paid';
    payment.paidAt ||= new Date();
    if (receipt) payment.receipt = receipt;
    if (amount) payment.amount = amount;
  } else {
    payment.status = 'failed';
  }
}

const stkSchema = z.object({
  phone: z.string().trim().min(1, 'Enter your M-Pesa phone number').max(20),
  amount: z.coerce
    .number()
    .int('Enter a whole number of shillings')
    .min(env.mpesa.minAmount, `The smallest amount is KES ${env.mpesa.minAmount}`)
    .max(env.mpesa.maxAmount, `The largest amount is KES ${env.mpesa.maxAmount.toLocaleString('en-KE')}`),
  promotionId: z.string().regex(/^[a-f0-9]{24}$/i).nullable().optional(),
});

// Starts a payment: Safaricom sends the "enter your M-Pesa PIN" prompt to the phone.
router.post('/stk', stkLimiter, optionalAuth, validate(stkSchema), async (req, res) => {
  if (!mpesaEnabled()) throw new HttpError(503, 'M-Pesa payments are not set up yet');
  const { amount, promotionId } = req.valid.body;
  const phone = normalizePhone(req.valid.body.phone);
  if (!phone) throw badRequest('Enter a Safaricom number like 0712 345 678');

  // One prompt at a time per phone.
  const recent = await Payment.exists({ phone, status: 'pending', createdAt: { $gt: new Date(Date.now() - 60_000) } });
  if (recent) throw new HttpError(429, 'A payment request was just sent to this phone. Check it, or try again in a minute.');

  // The purpose comes from the promotion an admin set up, never from the browser.
  const promotion = promotionId ? await Promotion.findById(promotionId).select('purpose') : null;
  const payment = await Payment.create({
    user: req.user?._id,
    promotion: promotion?._id,
    purpose: promotion?.purpose || 'donation',
    phone,
    amount,
  });

  try {
    const result = await stkPush({ phone, amount, description: 'Support A-Read' });
    payment.checkoutRequestId = result.checkoutRequestId;
    payment.merchantRequestId = result.merchantRequestId;
    await payment.save();
  } catch (err) {
    payment.status = 'failed';
    payment.resultDesc = err.message;
    await payment.save();
    console.warn(`M-Pesa STK push failed: ${err.message}`);
    throw new HttpError(502, "We couldn't reach M-Pesa. Please try again in a moment.");
  }
  res.status(201).json({ payment: publicPayment(payment) });
});

// Safaricom posts the outcome here. The secret in the path keeps strangers from faking results.
router.post('/mpesa/callback/:secret', async (req, res) => {
  const expected = Buffer.from(env.mpesa.callbackSecret || '');
  const given = Buffer.from(req.params.secret || '');
  if (!expected.length || expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw notFound();

  const result = parseCallback(req.body);
  if (result) {
    const payment = await Payment.findOne({ checkoutRequestId: result.checkoutRequestId });
    if (!payment) {
      console.warn(`M-Pesa callback for unknown request ${result.checkoutRequestId}`);
    } else if (payment.status !== 'paid' || !payment.receipt) {
      if (result.resultCode === 0 && result.amount !== undefined && result.amount !== payment.amount) {
        console.warn(`M-Pesa paid KES ${result.amount} for payment ${payment.id} (asked for ${payment.amount})`);
      }
      settle(payment, result);
      await payment.save();
    }
  }
  // Daraja only needs to know we received it.
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// --- Admin ---------------------------------------------------------------------------------
// (Registered before /:id so "/" isn't taken for an id.)

const listSchema = z.object({
  status: z.enum(['pending', 'paid', 'failed']).optional(),
  purpose: z.string().trim().max(40).optional(),
});

router.get('/', requireAuth, requireAdmin, validate(listSchema, 'query'), async (req, res) => {
  const { status, purpose } = req.valid.query;
  const filter = {};
  if (status) filter.status = status;
  if (purpose) filter.purpose = purpose;

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const [payments, totals, thisMonth] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).limit(200).populate('user', 'name email').populate('promotion', 'title'),
    Payment.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: '$purpose', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { status: 'paid', paidAt: { $gte: startOfMonth } } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
  ]);
  res.json({
    payments,
    totals: {
      amount: totals.reduce((sum, t) => sum + t.amount, 0),
      count: totals.reduce((sum, t) => sum + t.count, 0),
      thisMonth: thisMonth[0]?.amount || 0,
      byPurpose: Object.fromEntries(totals.map((t) => [t._id, { amount: t.amount, count: t.count }])),
    },
  });
});

// The payer's page polls this. If Safaricom's callback is slow or lost, ask Daraja directly.
router.get('/:id', async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw notFound('Payment not found');

  const age = Date.now() - payment.createdAt.getTime();
  const due = !payment.checkedAt || Date.now() - payment.checkedAt.getTime() > QUERY_EVERY_MS;
  if (payment.status === 'pending' && payment.checkoutRequestId && age > QUERY_AFTER_MS && due && mpesaEnabled()) {
    payment.checkedAt = new Date();
    try {
      const result = await stkQuery(payment.checkoutRequestId);
      if (result) settle(payment, result);
    } catch (err) {
      console.warn(`M-Pesa status check for ${payment.id} failed: ${err.message}`);
    }
    if (payment.status === 'pending' && age > GIVE_UP_MS) {
      payment.status = 'failed';
      payment.resultDesc = 'No answer from M-Pesa';
    }
    await payment.save();
  }
  res.json({ payment: publicPayment(payment) });
});

export default router;
