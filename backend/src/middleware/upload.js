import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/httpError.js';

const uploadDir = path.join(os.tmpdir(), 'a-read-uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

export const BOOK_EXTENSIONS = { '.pdf': 'pdf', '.epub': 'epub', '.txt': 'txt' };
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac']);

function extensionOf(file) {
  return path.extname(file.originalname || '').toLowerCase();
}

function fileFilter(req, file, cb) {
  const ext = extensionOf(file);
  const ok =
    (file.fieldname === 'file' && ext in BOOK_EXTENSIONS) ||
    (file.fieldname === 'cover' && IMAGE_EXTENSIONS.has(ext) && file.mimetype.startsWith('image/')) ||
    (file.fieldname === 'audio' && AUDIO_EXTENSIONS.has(ext));
  if (ok) return cb(null, true);

  const expected = {
    file: 'a PDF, EPUB or TXT file',
    cover: 'a JPG, PNG, WEBP or GIF image',
    audio: 'an MP3, M4A, M4B, AAC, OGG, OPUS, WAV or FLAC file',
  }[file.fieldname];
  cb(badRequest(expected ? `"${file.originalname}" is not ${expected}` : `Unexpected file field "${file.fieldname}"`));
}

const mb = (n) => n * 1024 * 1024;

// Deletes multer's temp files once the response has been sent (success or failure).
function cleanupTempFiles(req, res, next) {
  res.on('close', () => {
    const files = [req.file, ...Object.values(req.files || {}).flat()].filter(Boolean);
    for (const file of files) fs.rm(file.path, { force: true }, () => {});
  });
  next();
}

function withCleanup(middleware) {
  return [cleanupTempFiles, middleware];
}

export const uploadBook = withCleanup(
  multer({ storage, fileFilter, limits: { fileSize: mb(Math.max(env.maxBookMb, env.maxCoverMb)), files: 2 } }).fields([
    { name: 'file', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
);

export const uploadCover = withCleanup(
  multer({ storage, fileFilter, limits: { fileSize: mb(env.maxCoverMb), files: 1 } }).single('cover'),
);

export const uploadAudio = withCleanup(
  multer({ storage, fileFilter, limits: { fileSize: mb(env.maxAudioMb), files: 1 } }).single('audio'),
);

export function assertMaxSize(file, maxMb, label) {
  if (file && file.size > mb(maxMb)) throw badRequest(`${label} must be ${maxMb} MB or smaller`);
}
