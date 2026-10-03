// Loads backend/.env (if present) and exposes typed, validated settings.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see backend/.env.example)`);
  return value;
}

function number(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${name} must be a number`);
  return parsed;
}

function list(name) {
  return (process.env[name] || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

const isTest = process.env.NODE_ENV === 'test';

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: number('PORT', 5000),
  mongoUri: isTest ? process.env.MONGODB_URI : required('MONGODB_URI'),
  jwtSecret: isTest ? 'test-secret' : required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientOrigins: list('CLIENT_ORIGIN').length ? list('CLIENT_ORIGIN') : ['http://localhost:5173'],
  // Where shared links send people (defaults to the first CLIENT_ORIGIN).
  frontendUrl: (process.env.FRONTEND_URL || list('CLIENT_ORIGIN')[0] || 'http://localhost:5173').replace(/\/$/, ''),
  adminEmails: list('ADMIN_EMAILS'),
  // Super admins run the whole system: roles, site settings, and everything admins can do.
  superAdminEmails: list('SUPER_ADMIN_EMAILS'),
  cloudinaryUrl: process.env.CLOUDINARY_URL,
  cloudinaryFolder: process.env.CLOUDINARY_FOLDER || 'a-read',
  maxBookMb: number('MAX_BOOK_MB', 100),
  maxAudioMb: number('MAX_AUDIO_MB', 100),
  // Largest single file your Cloudinary plan accepts (free plan: 10 MB for PDFs/raw files).
  // Bigger books are stored as several parts below this size.
  cloudinaryMaxFileMb: number('CLOUDINARY_MAX_FILE_MB', 10),
  maxCoverMb: number('MAX_COVER_MB', 5),
  // Google Cloud TTS uses GOOGLE_APPLICATION_CREDENTIALS (path to a service-account JSON file).
  googleTtsEnabled: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
  defaultTtsVoice: process.env.GOOGLE_TTS_DEFAULT_VOICE || 'en-US-Neural2-F',
  narrationMaxChars: number('NARRATION_MAX_CHARS', 1_500_000),
  // Brevo transactional email (account confirmation, assignment notices). Without a key,
  // new accounts are confirmed automatically.
  brevoApiKey: process.env.BREVO_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  emailFromName: process.env.EMAIL_FROM_NAME || 'A-Read',
  // OAuth client ID for "Sign in with Google" (Google Cloud console → Credentials).
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  // IndexNow key (8-128 letters, digits or dashes; make one up). When set, new and changed book and
  // author pages are announced to Bing, Yandex and the other IndexNow search engines right away.
  // Google doesn't take part: it reads the sitemap.
  indexNowKey: /^[A-Za-z0-9-]{8,128}$/.test(process.env.INDEXNOW_KEY || '') ? process.env.INDEXNOW_KEY : '',
  // Daily popup hours are read in this time zone.
  timeZone: process.env.TIME_ZONE || 'Africa/Nairobi',
  // ISA Tech Hub: one M-Pesa till shared by all ISA platforms. When all three are set, new
  // payments go through the Hub (its dashboard issues the API key and webhook secret) and the
  // Daraja settings below are only used to settle payments started before the switch.
  hub: {
    // Just the Hub API's address. A pasted /api or /v1 on the end is dropped: the client adds /v1 itself.
    url: (process.env.ISA_HUB_URL || '').trim().replace(/\/+$/, '').replace(/\/(api|v1)$/i, ''),
    apiKey: process.env.ISA_HUB_API_KEY || '',
    webhookSecret: process.env.ISA_HUB_WEBHOOK_SECRET || '',
  },
  // M-Pesa (Safaricom Daraja) STK Push to a Buy Goods till or a Paybill, used directly when the
  // Hub isn't configured. MPESA_MIN_AMOUNT / MPESA_MAX_AMOUNT apply either way.
  mpesa: {
    environment: process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox',
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    // Business short code used to sign requests: the store (head office) number for a till,
    // or the Paybill number.
    shortcode: process.env.MPESA_SHORTCODE || '',
    passkey: process.env.MPESA_PASSKEY || '',
    // The till customers pay into. Leave empty to use a Paybill (MPESA_SHORTCODE).
    tillNumber: process.env.MPESA_TILL_NUMBER || '',
    // Public HTTPS address of this API, e.g. https://api.example.com (Safaricom calls it back).
    callbackBaseUrl: (process.env.MPESA_CALLBACK_BASE_URL || '').replace(/\/$/, ''),
    // Random string that makes the callback URL unguessable.
    callbackSecret: process.env.MPESA_CALLBACK_SECRET || '',
    accountReference: process.env.MPESA_ACCOUNT_REFERENCE || 'A-Read',
    minAmount: number('MPESA_MIN_AMOUNT', 10),
    maxAmount: number('MPESA_MAX_AMOUNT', 150_000),
  },
};
