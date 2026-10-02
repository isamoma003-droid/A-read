import textToSpeech from '@google-cloud/text-to-speech';
import { parseBuffer } from 'music-metadata';
import { env } from '../config/env.js';
import { Book } from '../models/Book.js';
import { Section, unpackParagraphs } from '../models/Section.js';
import { badRequest, conflict } from '../utils/httpError.js';
import { applyTimepoints, buildSsmlChunks, fillMissingMarks } from './ssml.js';
import { bookFolder, destroyAsset, errorMessage, privateSuffix, uploadBuffer } from './storage.js';
import { cloudinary } from '../config/cloudinary.js';

// Only these voice families accept SSML <mark> tags (Chirp and Journey voices do not).
const SSML_VOICE = /-(Standard|Wavenet|Neural2|News|Studio)-/;

let client;
function ttsClient() {
  if (client) return client;
  if (!env.googleTtsEnabled) throw badRequest('Cloud narration is not configured on this server (GOOGLE_APPLICATION_CREDENTIALS)');
  client = new textToSpeech.v1beta1.TextToSpeechClient();
  return client;
}

// Lets tests swap in a fake Google client.
export function setTtsClient(fake) {
  client = fake;
  voiceCache = { at: 0, voices: [] };
}

export const languageOfVoice = (voice) => voice.split('-').slice(0, 2).join('-');

let voiceCache = { at: 0, voices: [] };
export async function listVoices(language) {
  if (Date.now() - voiceCache.at > 60 * 60 * 1000) {
    const [response] = await ttsClient().listVoices({});
    voiceCache = {
      at: Date.now(),
      voices: (response.voices || [])
        .filter((v) => SSML_VOICE.test(v.name))
        .map((v) => ({
          name: v.name,
          gender: v.ssmlGender,
          languageCodes: v.languageCodes,
          tier: SSML_VOICE.exec(v.name)[1],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  if (!language) return voiceCache.voices;
  const prefix = language.toLowerCase();
  return voiceCache.voices.filter((v) => v.languageCodes.some((code) => code.toLowerCase().startsWith(prefix)));
}

async function mp3Duration(buffer) {
  const format = await parseBuffer(buffer, { mimeType: 'audio/mpeg' }, { duration: true })
    .then((meta) => meta.format)
    .catch(() => ({}));
  if (format.duration) return format.duration;
  // Fallback: constant-bitrate estimate (Google returns 32 kbps MP3 by default).
  return (buffer.length * 8) / (format.bitrate || 32000);
}

export async function synthesizeSection(paragraphs, voice) {
  const sentenceCount = paragraphs.reduce((n, p) => n + p.length, 0);
  const marks = new Array(sentenceCount).fill(null);
  const buffers = [];
  let offset = 0;
  for (const chunk of buildSsmlChunks(paragraphs)) {
    const [response] = await ttsClient().synthesizeSpeech({
      input: { ssml: chunk.ssml },
      voice: { languageCode: languageOfVoice(voice), name: voice },
      audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 },
      enableTimePointing: ['SSML_MARK'],
    });
    const audio = Buffer.from(response.audioContent);
    applyTimepoints(marks, response.timepoints, offset);
    offset += await mp3Duration(audio);
    buffers.push(audio);
  }
  return { audio: Buffer.concat(buffers), duration: offset, marks: fillMissingMarks(marks) };
}

// --- Background jobs -------------------------------------------------------------------------

const jobs = new Map(); // bookId -> { cancelled, done: Promise }

export const isNarrating = (bookId) => jobs.has(String(bookId));

export async function startNarration(book, { voice, user }) {
  const bookId = String(book._id);
  if (jobs.has(bookId)) throw conflict('Narration is already being generated for this book');
  if (!book.wordCount) throw badRequest('This book has no text to narrate (scanned PDFs have no text layer)');
  if (book.charCount > env.narrationMaxChars) {
    throw badRequest(
      `This book is too long to narrate (${book.charCount.toLocaleString()} characters, limit ${env.narrationMaxChars.toLocaleString()})`,
    );
  }
  ttsClient();

  const [totalSections, alreadyDone] = await Promise.all([
    Section.countDocuments({ book: book._id, sentenceCount: { $gt: 0 } }),
    Section.countDocuments({ book: book._id, sentenceCount: { $gt: 0 }, 'narration.voice': voice }),
  ]);

  book.narration = {
    status: 'generating',
    voice,
    languageCode: languageOfVoice(voice),
    completedSections: alreadyDone,
    totalSections,
    requestedBy: user._id,
    startedAt: new Date(),
  };
  await book.save();

  const job = { cancelled: false };
  job.done = runJob(book._id, voice, job).finally(() => jobs.delete(bookId));
  jobs.set(bookId, job);
  return book;
}

async function runJob(bookId, voice, job) {
  try {
    // Load ids up front and each section on demand: a job can run for hours, longer than a cursor lives.
    const ordered = await Section.find({ book: bookId, sentenceCount: { $gt: 0 } }).sort({ index: 1 }).select('_id').lean();
    for (const { _id } of ordered) {
      if (job.cancelled) break;
      const section = await Section.findById(_id);
      if (!section) continue;
      if (section.narration?.voice === voice && section.narration.url) continue; // already done (resume)

      const result = await synthesizeSection(unpackParagraphs(section.sentences, section.paragraphStarts), voice);
      if (job.cancelled) break;
      // A fresh unguessable name, so a premium book's locked chapters can't be fetched by URL.
      const asset = await uploadBuffer(result.audio, {
        publicId: `${bookFolder(bookId)}/narration/section-${String(section.index).padStart(4, '0')}-${privateSuffix()}`,
        resourceType: 'video',
      });
      const previous = section.narration;
      section.narration = { url: asset.url, publicId: asset.publicId, voice, duration: result.duration, marks: result.marks };
      await section.save();
      if (previous?.publicId) await destroyAsset({ publicId: previous.publicId, resourceType: 'video' });
      await Book.updateOne({ _id: bookId }, { $inc: { 'narration.completedSections': 1 } });
    }

    const book = await Book.findById(bookId).select('narration');
    if (!book) return;
    const { completedSections, totalSections } = book.narration;
    const status = completedSections >= totalSections ? 'ready' : completedSections > 0 ? 'partial' : 'none';
    await Book.updateOne({ _id: bookId }, { $set: { 'narration.status': status, 'narration.finishedAt': new Date() } });
  } catch (err) {
    console.error(`Narration failed for book ${bookId}:`, err);
    await Book.updateOne(
      { _id: bookId },
      {
        $set: {
          'narration.status': 'failed',
          'narration.error': (err.details || err.message || 'Unknown error').slice(0, 500),
          'narration.finishedAt': new Date(),
        },
      },
    ).catch(() => {});
  }
}

// Stops a running job and waits for it to finish its current step.
export async function stopNarration(bookId) {
  const job = jobs.get(String(bookId));
  if (!job) return;
  job.cancelled = true;
  await job.done;
}

export async function deleteNarration(book) {
  await stopNarration(book._id);
  await cloudinary.api
    .delete_resources_by_prefix(`${bookFolder(book._id)}/narration/`, { resource_type: 'video' })
    .catch((err) => console.warn(`Could not delete narration audio: ${errorMessage(err)}`));
  await Section.updateMany({ book: book._id }, { $unset: { narration: 1 } });
  book.narration = { status: 'none' };
  await book.save();
}

// Jobs live in memory, so any job marked "generating" at startup was cut off by a restart.
export async function markInterruptedJobs() {
  await Book.updateMany(
    { 'narration.status': 'generating' },
    { $set: { 'narration.status': 'failed', 'narration.error': 'Interrupted by a server restart. Start it again to resume.' } },
  );
}
