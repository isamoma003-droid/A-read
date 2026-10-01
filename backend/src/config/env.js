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
};
