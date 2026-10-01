// Safaricom Daraja: Lipa na M-Pesa Online (STK Push) to a Buy Goods till or a Paybill.
// Docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
import { env } from '../config/env.js';

const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

// STK result codes worth explaining to the payer in plain words.
const RESULT_MESSAGES = {
  0: 'Payment received',
  1: 'Your M-Pesa balance is too low for this payment',
  1032: 'You cancelled the payment on your phone',
  1037: "We couldn't reach your phone. Check it's on and has signal, then try again",
  2001: 'The M-Pesa PIN was wrong',
};

export const resultMessage = (code, fallback) => RESULT_MESSAGES[code] || fallback || 'The payment did not go through';

const config = () => env.mpesa;

export const mpesaEnabled = () => {
  const c = config();
  return Boolean(c.consumerKey && c.consumerSecret && c.shortcode && c.passkey && c.callbackBaseUrl && c.callbackSecret);
};

export const callbackUrl = () => `${config().callbackBaseUrl}/api/payments/mpesa/callback/${config().callbackSecret}`;

// Accepts 07XXXXXXXX, 01XXXXXXXX, 7XXXXXXXX, +2547XXXXXXXX and 2547XXXXXXXX (spaces and dashes allowed).
// Returns 2547XXXXXXXX / 2541XXXXXXXX, or null if it isn't a Kenyan mobile number.
export function normalizePhone(input) {
  const digits = String(input || '').replace(/[\s\-()]/g, '').replace(/^\+/, '');
  let local;
  if (/^254[17]\d{8}$/.test(digits)) local = digits.slice(3);
  else if (/^0[17]\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^[17]\d{8}$/.test(digits)) local = digits;
  else return null;
  return `254${local}`;
}

// 0712345678 → 0712***678, for lists shown to admins.
export const maskPhone = (phone) => (phone ? `0${phone.slice(3, 6)}***${phone.slice(-3)}` : '');

// Daraja wants the request time in Kenya time as YYYYMMDDHHmmss.
export function timestamp(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

function password(time) {
  const c = config();
  return Buffer.from(`${c.shortcode}${c.passkey}${time}`).toString('base64');
}

async function fetchTransport(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Daraja sometimes answers errors with HTML.
  }
  return { status: res.status, json };
}

let transport = fetchTransport;
let token = null; // { value, expiresAt }

// Tests swap the HTTP layer with a fake.
export function setMpesaTransport(fake) {
  transport = fake || fetchTransport;
  token = null;
}

export class MpesaError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const describe = (json) => json?.errorMessage || json?.ResponseDescription || json?.resultDesc || 'no details';

async function accessToken() {
  if (token && token.expiresAt > Date.now()) return token.value;
  const c = config();
  const basic = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString('base64');
  const { status, json } = await transport(`${BASE_URLS[c.environment]}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { authorization: `Basic ${basic}` },
  });
  if (status !== 200 || !json?.access_token) {
    throw new MpesaError(`M-Pesa sign-in failed (${status}): check MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET`, { status });
  }
  // Tokens last an hour; renew a minute early.
  token = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in || 3599) - 60) * 1000 };
  return token.value;
}

async function call(path, body) {
  const c = config();
  const { status, json } = await transport(`${BASE_URLS[c.environment]}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}` },
    body,
  });
  if (status === 401) token = null;
  return { status, json };
}

// Sends the "enter your M-Pesa PIN" prompt to the payer's phone.
export async function stkPush({ phone, amount, description = 'Support' }) {
  const c = config();
  const time = timestamp();
  const { status, json } = await call('/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: c.shortcode,
    Password: password(time),
    Timestamp: time,
    TransactionType: c.tillNumber ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: c.tillNumber || c.shortcode,
    PhoneNumber: phone,
    CallBackURL: callbackUrl(),
    AccountReference: c.accountReference.slice(0, 12),
    TransactionDesc: description.slice(0, 13),
  });
  if (status !== 200 || json?.ResponseCode !== '0') {
    throw new MpesaError(`M-Pesa refused the request: ${describe(json)}`, { code: json?.errorCode, status });
  }
  return { checkoutRequestId: json.CheckoutRequestID, merchantRequestId: json.MerchantRequestID, message: json.CustomerMessage };
}

// Asks Daraja how an STK request ended. Returns null while the payer hasn't answered yet.
export async function stkQuery(checkoutRequestId) {
  const c = config();
  const time = timestamp();
  const { status, json } = await call('/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: c.shortcode,
    Password: password(time),
    Timestamp: time,
    CheckoutRequestID: checkoutRequestId,
  });
  if (status === 200 && json?.ResultCode !== undefined) {
    return { resultCode: Number(json.ResultCode), resultDesc: json.ResultDesc };
  }
  // "The transaction is being processed" comes back as an error until the payer answers.
  if (json?.errorCode === '500.001.1001') return null;
  throw new MpesaError(`M-Pesa status check failed: ${describe(json)}`, { code: json?.errorCode, status });
}

// Pulls the useful fields out of an STK callback body.
export function parseCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return null;
  const items = Object.fromEntries((cb.CallbackMetadata?.Item || []).map((item) => [item.Name, item.Value]));
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    merchantRequestId: cb.MerchantRequestID,
    resultCode: Number(cb.ResultCode),
    resultDesc: cb.ResultDesc,
    amount: items.Amount !== undefined ? Number(items.Amount) : undefined,
    receipt: items.MpesaReceiptNumber,
    phone: items.PhoneNumber !== undefined ? String(items.PhoneNumber) : undefined,
  };
}
