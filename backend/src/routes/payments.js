import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAdmin } from '../middleware/admin.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Book } from '../models/Book.js';
import { Payment } from '../models/Payment.js';
import { Promotion } from '../models/Promotion.js';
import { applyHubPayment, hub, hubConfig, hubEnabled, hubStatus, verifyHubWebhook } from '../services/hub.js';
import { mpesaEnabled, normalizePhone, parseCallback, resultMessage, stkPush, stkQuery } from '../services/mpesa.js';
import { passExpiry } from '../services/pass.js';
import { isPremium, lockedSectionsFor } from '../services/premium.js';
import { getSettings, passOnSale } from '../services/settings.js';
import { HttpError, badRequest, conflict, notFound, unauthorized } from '../utils/httpError.js';

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

// Direct Daraja: how long to wait for Safaricom's callback before asking Daraja ourselves, and how often.
const QUERY_AFTER_MS = 20_000;
const QUERY_EVERY_MS = 10_000;
// After this, a direct payment with no answer at all counts as failed (a late callback still settles it).
const GIVE_UP_MS = 5 * 60 * 1000;
// Through the Hub: the Hub pushes the result by webhook; while the payer's page waits we also ask
// it this often (it checks with Safaricom itself when the callback is late).
const HUB_CHECK_EVERY_MS = 5_000;

const unavailable = () => new HttpError(502, "We couldn't reach M-Pesa. Please try again in a moment.");

router.get('/config', async (_req, res) => {
  const c = env.mpesa;
  const limits = { minAmount: c.minAmount, maxAmount: c.maxAmount };
  if (hubEnabled()) {
    let till = null;
    let waking = false;
    try {
      ({ till } = await hubConfig());
    } catch (err) {
      // A Hub that is asleep or briefly down still takes payments in a moment (the prompt itself
      // reports an outage), so readers keep the payment form. A refused key or a missing Hub means
      // "not set up yet"; Admin → Payments shows the reason in plain words.
      waking = !err.status || err.status >= 500;
      console.warn(`ISA Tech Hub config unavailable (HTTP ${err.status ?? 'none'}): ${err.message}`);
    }
    return res.json({
      enabled: waking || Boolean(till?.active),
      method: till?.kind ?? null,
      number: till?.payNumber ?? null,
      accountReference: till?.accountNumber ?? null,
      ...limits,
    });
  }
  res.json({
    enabled: mpesaEnabled(),
    // For paying by hand from the M-Pesa menu.
    method: c.tillNumber ? 'till' : c.shortcode ? 'paybill' : null,
    number: c.tillNumber || c.shortcode || null,
    accountReference: c.tillNumber ? null : c.accountReference,
    ...limits,
  });
});

const publicPayment = (p) => ({
  id: p.id,
  status: p.status,
  amount: p.amount,
  receipt: p.receipt || null,
  message:
    p.status === 'pending'
      ? null
      : p.status === 'disputed'
        ? 'M-Pesa reported a different amount. We will check it, so there is no need to pay again.'
        : p.provider === 'hub'
          ? p.resultDesc || resultMessage(p.resultCode)
          : resultMessage(p.resultCode, p.resultDesc),
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
    .max(env.mpesa.maxAmount, `The largest amount is KES ${env.mpesa.maxAmount.toLocaleString('en-KE')}`)
    .optional(),
  promotionId: z.string().regex(/^[a-f0-9]{24}$/i).nullable().optional(),
  // Unlocking a premium book: the amount is the book's price, whatever the browser sends.
  bookId: z.string().regex(/^[a-f0-9]{24}$/i).nullable().optional(),
  // Buying the Premium Pass: the price and days are the admins', whatever the browser sends.
  pass: z.boolean().optional(),
});

const describePayment = (book, days) =>
  book ? `Unlock "${book.title.slice(0, 60)}" on A-Read` : days ? `A-Read Premium Pass, ${days} days` : 'Support A-Read';

// Asks ISA Tech Hub to send the prompt for `payment`. A-Read's own payment id is the Hub reference
// and the idempotency key, so a retried request can never prompt the payer twice.
async function startThroughHub(payment, { promotion, book }) {
  try {
    const { payment: remote } = await hub().createPayment({
      phone: payment.phone,
      amount: payment.amount,
      reference: payment.id,
      purpose: payment.purpose,
      description: describePayment(book, payment.days),
      idempotencyKey: payment.id,
      metadata: {
        promotion: promotion?.id ?? null,
        reader: payment.user ? 'signed-in' : 'guest',
        ...(book ? { book: book.id } : {}),
        ...(payment.days ? { passDays: payment.days } : {}),
      },
    });
    applyHubPayment(payment, remote);
    await payment.save();
  } catch (err) {
    payment.status = 'failed';
    payment.resultDesc = err.message;
    if (err.payment?.id) payment.hubPaymentId = err.payment.id;
    await payment.save();
    if (err.status === 409) throw new HttpError(429, 'A payment request was just sent to this phone. Check it, or try again in a minute.');
    if (err.status === 400) throw badRequest(err.message);
    console.warn(`ISA Tech Hub refused or couldn't be reached for payment ${payment.id}: ${err.message}`);
    throw unavailable();
  }
}

async function startThroughDaraja(payment, { book }) {
  try {
    // Daraja keeps only 13 characters of the description.
    const description = book ? 'A-Read book' : payment.purpose === 'pass' ? 'A-Read pass' : 'Support A-Read';
    const result = await stkPush({ phone: payment.phone, amount: payment.amount, description });
    payment.checkoutRequestId = result.checkoutRequestId;
    payment.merchantRequestId = result.merchantRequestId;
    await payment.save();
  } catch (err) {
    payment.status = 'failed';
    payment.resultDesc = err.message;
    await payment.save();
    console.warn(`M-Pesa STK push failed: ${err.message}`);
    throw unavailable();
  }
}

// Starts a payment: Safaricom sends the "enter your M-Pesa PIN" prompt to the phone.
router.post('/stk', stkLimiter, optionalAuth, validate(stkSchema), async (req, res) => {
  const viaHub = hubEnabled();
  if (!viaHub && !mpesaEnabled()) throw new HttpError(503, 'M-Pesa payments are not set up yet');
  const { promotionId, bookId, pass } = req.valid.body;
  let { amount } = req.valid.body;
  let days;
  const phone = normalizePhone(req.valid.body.phone);
  if (!phone) throw badRequest('Enter a Safaricom number like 0712 345 678');

  // A premium book is unlocked for the signed-in reader who pays for it, at the admin's price.
  let book = null;
  if (bookId) {
    if (!req.user) throw unauthorized('Sign in to unlock this book');
    book = await Book.findById(bookId).select('title premium uploadedBy');
    if (!book) throw notFound('Book not found');
    if (!isPremium(book)) throw badRequest('This book is free to read');
    if (!(await lockedSectionsFor(book, req.user)).size) throw conflict('You have already unlocked this book');
    // M-Pesa reported a different amount for an earlier payment: the money moved, so don't ask again
    // while it's checked (the Hub settles it as paid or failed).
    if (await Payment.exists({ user: req.user._id, book: book._id, status: 'disputed' })) {
      throw conflict("We're checking your earlier payment for this book (M-Pesa reported a different amount), so there's no need to pay again.");
    }
    // A prompt for this book may still be open (the reader reloaded, or M-Pesa's answer is late):
    // pick that payment up again instead of charging twice.
    const waiting = await resumablePayment(req.user, { book: book._id });
    if (waiting?.status === 'paid') throw conflict('You have already unlocked this book');
    if (waiting) return res.json({ payment: publicPayment(waiting), resumed: true });
    amount = book.premium.price;
  } else if (pass) {
    // The Premium Pass, for the signed-in reader. Buying it again while it lasts adds the days on.
    if (!req.user) throw unauthorized('Sign in to get the Premium Pass');
    const onSale = passOnSale(await getSettings());
    if (!onSale) throw badRequest('The Premium Pass is not on sale right now');
    if (await Payment.exists({ user: req.user._id, purpose: 'pass', status: 'disputed' })) {
      throw conflict("We're checking your earlier Premium Pass payment (M-Pesa reported a different amount), so there's no need to pay again.");
    }
    // A pass prompt may still be open: follow that one rather than charging twice.
    const waiting = await resumablePayment(req.user, { purpose: 'pass' });
    if (waiting) return res.json({ payment: publicPayment(waiting), resumed: true });
    ({ price: amount, days } = onSale);
  } else if (amount === undefined) {
    throw badRequest('Enter an amount');
  }

  // One prompt at a time per phone.
  const recent = await Payment.exists({ phone, status: 'pending', createdAt: { $gt: new Date(Date.now() - 60_000) } });
  if (recent) throw new HttpError(429, 'A payment request was just sent to this phone. Check it, or try again in a minute.');

  // The purpose comes from the promotion an admin set up, never from the browser.
  const promotion = promotionId && !book && !pass ? await Promotion.findById(promotionId).select('purpose') : null;
  const fields = {
    user: req.user?._id,
    promotion: promotion?._id,
    book: book?._id,
    purpose: book ? 'book' : pass ? 'pass' : promotion?.purpose || 'donation',
    phone,
    amount,
    days,
    provider: viaHub ? 'hub' : 'daraja',
  };
  // Purchases that belong to one reader: only one prompt may wait for M-Pesa at a time.
  const owned = book ? { book: book._id } : pass ? { purpose: 'pass' } : null;
  let payment;
  for (let attempt = 1; !payment; attempt++) {
    try {
      payment = await Payment.create(fields);
    } catch (err) {
      // Two unlock (or pass) requests at the same moment (two tabs or devices): only one payment
      // may be waiting per reader and book, so the second one follows the first. If that one has
      // already ended (its prompt was refused), try once more.
      if (err.code !== 11000 || !owned) throw err;
      const first = await Payment.findOne({ user: req.user._id, ...owned, status: 'pending' });
      if (first) return res.json({ payment: publicPayment(first), resumed: true });
      if (attempt >= 2) throw new HttpError(429, 'A payment request for this was just sent. Check your phone, or try again in a minute.');
    }
  }

  if (viaHub) await startThroughHub(payment, { promotion, book });
  else await startThroughDaraja(payment, { book });
  res.status(201).json({ payment: publicPayment(payment) });
});

// ISA Tech Hub posts payment.paid / payment.failed / payment.disputed here, signed with the
// webhook secret from the Hub dashboard. Register https://<this API>/api/payments/hub-webhook there.
router.post('/hub-webhook', async (req, res) => {
  if (!hubEnabled()) throw notFound();
  let event;
  try {
    event = verifyHubWebhook(req.rawBody, req.get('isa-signature'));
  } catch {
    throw new HttpError(400, 'Invalid ISA Tech Hub signature');
  }

  const remote = event.data?.payment;
  if (remote?.id) {
    const payment =
      (await Payment.findOne({ hubPaymentId: remote.id })) ||
      (mongoose.isValidObjectId(remote.reference) ? await Payment.findOne({ _id: remote.reference, provider: 'hub' }) : null);
    if (!payment) console.warn(`ISA Tech Hub ${event.type} for unknown payment ${remote.id} (reference ${remote.reference})`);
    else if (applyHubPayment(payment, remote)) await payment.save();
  }
  // Anything signed and understood is acknowledged, including `ping` from the dashboard's test button.
  res.status(204).end();
});

// Safaricom posts the outcome here (direct Daraja only). The secret in the path keeps strangers
// from faking results.
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
  status: z.enum(['pending', 'paid', 'failed', 'disputed']).optional(),
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
    Payment.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('user', 'name email')
      .populate('promotion', 'title')
      .populate('book', 'title'),
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

// What Admin → Payments shows under "Payment setup": which way payments go, and if they can't, why.
router.get('/setup', requireAuth, requireAdmin, async (req, res) => {
  const hubState = await hubStatus();
  res.json({
    mode: hubEnabled() ? 'hub' : mpesaEnabled() ? 'daraja' : 'off',
    hub: { ...hubState, partial: hubState.missing.length > 0 && hubState.missing.length < 3 },
    // The address to enter as this platform's webhook URL in the Hub dashboard.
    webhookUrl: `${req.protocol}://${req.get('host')}/api/payments/hub-webhook`,
  });
});

// The reader's payment matching `filter` (a book unlock, or the pass) that is still waiting for
// M-Pesa, freshly checked, or null. One that has had no answer for GIVE_UP_MS counts as failed (a
// late success still settles it), so the reader can try again.
async function resumablePayment(user, filter) {
  let waiting = await Payment.findOne({ user: user._id, ...filter, status: 'pending' }).sort({ createdAt: -1 });
  if (!waiting) return null;
  waiting = await (waiting.provider === 'hub' ? refreshFromHub(waiting) : refreshFromDaraja(waiting));
  if (waiting.status === 'pending' && Date.now() - waiting.createdAt.getTime() > GIVE_UP_MS) waiting = await giveUp(waiting);
  return ['pending', 'paid'].includes(waiting.status) ? waiting : null;
}

const due = (payment, everyMs) => !payment.checkedAt || Date.now() - payment.checkedAt.getTime() > everyMs;

// Hub payments: ask the Hub (it checks with Safaricom itself when the callback is late).
async function refreshFromHub(payment) {
  if (!payment.hubPaymentId || !hubEnabled() || !due(payment, HUB_CHECK_EVERY_MS)) return payment;
  payment.checkedAt = new Date();
  try {
    const { payment: remote } = await hub().getPayment(payment.hubPaymentId);
    applyHubPayment(payment, remote);
  } catch (err) {
    console.warn(`ISA Tech Hub status check for ${payment.id} failed: ${err.message}`);
  }
  await payment.save();
  return payment;
}

// Marks a payment that never got an answer as failed, unless M-Pesa settled it in the meantime (a
// webhook or callback can land while we were asking): only a payment still pending in the
// database changes. Returns the payment as it is now.
async function giveUp(payment) {
  await Payment.updateOne({ _id: payment._id, status: 'pending' }, { $set: { status: 'failed', resultDesc: 'No answer from M-Pesa' } });
  return Payment.findById(payment._id);
}

// Direct payments: if Safaricom's callback is slow or lost, ask Daraja directly.
async function refreshFromDaraja(payment) {
  const age = Date.now() - payment.createdAt.getTime();
  if (!payment.checkoutRequestId || age <= QUERY_AFTER_MS || !due(payment, QUERY_EVERY_MS) || !mpesaEnabled()) return payment;
  payment.checkedAt = new Date();
  try {
    const result = await stkQuery(payment.checkoutRequestId);
    if (result) settle(payment, result);
  } catch (err) {
    console.warn(`M-Pesa status check for ${payment.id} failed: ${err.message}`);
  }
  await payment.save();
  return payment.status === 'pending' && age > GIVE_UP_MS ? giveUp(payment) : payment;
}

// The Premium Pass: whether it's on sale, what it opens, and until when the reader has it.
router.get('/pass', optionalAuth, async (req, res) => {
  const [settings, premiumBooks, activeUntil] = await Promise.all([
    getSettings(),
    Book.countDocuments({ 'premium.enabled': true, 'premium.lockedSections.0': { $exists: true } }),
    passExpiry(req.user),
  ]);
  const onSale = passOnSale(settings);
  res.json({
    onSale: Boolean(onSale),
    price: onSale?.price ?? null,
    days: onSale?.days ?? null,
    premiumBooks,
    // Kept after it runs out, so the page can say when it ended.
    activeUntil,
    active: Boolean(activeUntil && activeUntil > new Date()),
  });
});

// The payer's page polls this.
router.get('/:id', async (req, res) => {
  let payment = await Payment.findById(req.params.id);
  if (!payment) throw notFound('Payment not found');
  if (payment.status === 'pending') payment = await (payment.provider === 'hub' ? refreshFromHub(payment) : refreshFromDaraja(payment));
  res.json({ payment: publicPayment(payment) });
});

export default router;
