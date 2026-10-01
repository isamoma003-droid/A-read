// ISA Tech Hub: the shared payments service that owns the ISA M-Pesa till. A-Read asks it to send
// the PIN prompt, and the Hub reports back by signed webhook (and on request).
import { env } from '../config/env.js';
import { IsaHub, IsaHubError, verifyWebhook } from './isa-hub.cjs';

export { IsaHubError };

export const hubEnabled = () => Boolean(env.hub.url && env.hub.apiKey && env.hub.webhookSecret);

let client = null;
export function hub() {
  if (!client || client.baseUrl !== env.hub.url || client.apiKey !== env.hub.apiKey) {
    client = new IsaHub({ apiKey: env.hub.apiKey, baseUrl: env.hub.url, timeoutMs: 20_000 });
  }
  return client;
}

// Tests swap the client for a fake one.
export function setHubClient(fake) {
  client = fake;
}

// The till to show for paying from the M-Pesa menu. It rarely changes, so ask every 10 minutes.
let cachedConfig = null;
export async function hubConfig() {
  if (cachedConfig && cachedConfig.expiresAt > Date.now()) return cachedConfig.value;
  const value = await hub().config();
  cachedConfig = { value, expiresAt: Date.now() + 10 * 60_000 };
  return value;
}
export const clearHubConfig = () => {
  cachedConfig = null;
};

const HUB_SETTINGS = [
  ['ISA_HUB_URL', 'url'],
  ['ISA_HUB_API_KEY', 'apiKey'],
  ['ISA_HUB_WEBHOOK_SECRET', 'webhookSecret'],
];

// Turns a failed call to the Hub into what to do about it.
function explain(err) {
  if (err.status === 401) return 'The Hub rejected ISA_HUB_API_KEY. Copy the key again from the Hub dashboard (or issue a new one there), then redeploy.';
  if (err.status === 403) return 'The Hub has disabled this platform. Enable it on its page in the Hub dashboard.';
  if (err.status === 404) return `Nothing answered at ${env.hub.url}/v1/config. ISA_HUB_URL should be just the Hub API's address, e.g. https://isa-tech-hub.onrender.com`;
  if (!err.status) return `Couldn't reach ${env.hub.url} (${err.message}). Check ISA_HUB_URL and that the Hub is running.`;
  return `The Hub answered HTTP ${err.status}: ${err.message}`;
}

/**
 * Is the Hub set up, and does it answer? Asks it fresh (and refreshes the cached till).
 * @returns {Promise<{ configured: boolean, missing: string[], reachable?: boolean, error?: string, platform?: object, till?: object }>}
 */
export async function hubStatus() {
  const missing = HUB_SETTINGS.filter(([, key]) => !env.hub[key]).map(([name]) => name);
  if (missing.length) return { configured: false, missing };
  try {
    const value = await hub().config();
    cachedConfig = { value, expiresAt: Date.now() + 10 * 60_000 };
    return { configured: true, missing, reachable: true, platform: value.platform ?? null, till: value.till ?? null };
  } catch (err) {
    return { configured: true, missing, reachable: false, error: explain(err) };
  }
}

export const verifyHubWebhook = (rawBody, signature) =>
  verifyWebhook({ secret: env.hub.webhookSecret, rawBody: rawBody ?? '', signature });

/**
 * Copies the Hub's view of a payment onto A-Read's record. Returns true if anything changed.
 * A paid payment never goes back; a late success after a failure wins (the money really moved).
 */
export function applyHubPayment(payment, remote) {
  if (!remote?.status) return false;
  if (remote.id && !payment.hubPaymentId) payment.hubPaymentId = remote.id;

  if (remote.status === 'paid' && (payment.status !== 'paid' || (!payment.receipt && remote.receipt))) {
    payment.status = 'paid';
    payment.paidAt ||= remote.paidAt ? new Date(remote.paidAt) : new Date();
    if (remote.receipt) payment.receipt = remote.receipt;
    payment.resultCode = 0;
    payment.resultDesc = remote.message;
  } else if (remote.status === 'failed' && payment.status === 'pending') {
    payment.status = 'failed';
    payment.resultCode = remote.resultCode ?? undefined;
    payment.resultDesc = remote.message;
  } else if (remote.status === 'disputed' && ['pending', 'failed'].includes(payment.status)) {
    payment.status = 'disputed';
    payment.resultDesc = remote.message;
  }
  return payment.isModified();
}
