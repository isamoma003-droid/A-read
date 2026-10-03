// The Premium Pass: one M-Pesa payment opens every premium book for a number of days. Readers
// can buy it again before it runs out; the new days are added on the end.
import { Payment } from '../models/Payment.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// When each reader's pass runs out, from their paid pass payments (oldest first). Each payment's
// days start when it was paid, or when the time already bought ends if that's later.
function expiries(payments) {
  const ends = new Map();
  for (const p of payments) {
    const user = String(p.user);
    const paid = (p.paidAt ?? p.createdAt).getTime();
    ends.set(user, Math.max(ends.get(user) ?? 0, paid) + (p.days || 30) * DAY_MS);
  }
  return ends;
}

const paidPasses = (filter = {}) =>
  Payment.find({ ...filter, purpose: 'pass', status: 'paid' }).sort({ paidAt: 1, _id: 1 }).select('user paidAt createdAt days').lean();

// The date the reader's pass runs out, or null if they never bought one.
export async function passExpiry(user) {
  if (!user) return null;
  const end = expiries(await paidPasses({ user: user._id })).get(String(user._id));
  return end ? new Date(end) : null;
}

export async function hasActivePass(user) {
  const end = await passExpiry(user);
  return Boolean(end && end.getTime() > Date.now());
}

// For admins: how many readers hold a pass right now.
export async function activePassHolders() {
  const now = Date.now();
  return [...expiries(await paidPasses()).values()].filter((end) => end > now).length;
}
