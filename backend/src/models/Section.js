import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

// Generated narration audio for one section, with the start time (seconds) of every sentence.
const sectionNarrationSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    voice: String,
    duration: Number,
    marks: { type: [Number], default: [] },
  },
  { _id: false },
);

// One readable unit of a book: a page for PDFs, a spine item (chapter) for EPUBs,
// a chapter or chunk for TXT files. Text is stored as a flat list of sentences plus the
// index where each paragraph starts, so the reader, browser TTS and cloud narration all
// agree on sentence numbering.
const sectionSchema = new Schema({
  book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
  index: { type: Number, required: true },
  title: { type: String, default: '' },
  href: String, // EPUB spine href, used by the page view to jump to the chapter
  sentences: { type: [String], default: [] },
  paragraphStarts: { type: [Number], default: [] },
  wordCount: { type: Number, default: 0 },
  sentenceCount: { type: Number, default: 0 },
  narration: sectionNarrationSchema,
});

sectionSchema.index({ book: 1, index: 1 }, { unique: true });

// [['A.', 'B.'], ['C.']] -> { sentences: ['A.', 'B.', 'C.'], paragraphStarts: [0, 2] }
export function packParagraphs(paragraphs) {
  const sentences = [];
  const paragraphStarts = [];
  for (const paragraph of paragraphs) {
    paragraphStarts.push(sentences.length);
    sentences.push(...paragraph);
  }
  return { sentences, paragraphStarts };
}

export function unpackParagraphs(sentences = [], paragraphStarts = []) {
  return paragraphStarts.map((start, i) => sentences.slice(start, paragraphStarts[i + 1] ?? sentences.length));
}

export const Section = mongoose.model('Section', sectionSchema);
