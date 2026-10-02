import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from '../config/mongoose.js';
import { env } from '../config/env.js';
import { assertCloudinaryConfigured } from '../config/cloudinary.js';
import { BOOK_EXTENSIONS, assertMaxSize } from '../middleware/upload.js';
import { Assignment } from '../models/Assignment.js';
import { Book } from '../models/Book.js';
import { Bookmark } from '../models/Bookmark.js';
import { Progress } from '../models/Progress.js';
import { Section, packParagraphs } from '../models/Section.js';
import { badRequest } from '../utils/httpError.js';
import { extractBook } from './extract/index.js';
import { stopNarration } from './narration.js';
import {
  COVER_TRANSFORMATION,
  bookFolder,
  deleteBookFolder,
  destroyAsset,
  privateSuffix,
  uploadBookFile,
  uploadBuffer,
  uploadFile,
} from './storage.js';

export function parseTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

const stamp = () => Date.now().toString(36);

export async function createBook({ user, files, fields }) {
  const file = files?.file?.[0];
  if (!file) throw badRequest('Choose a PDF, EPUB or TXT file to upload');
  const coverFile = files?.cover?.[0];
  assertMaxSize(file, env.maxBookMb, 'The book file');
  assertMaxSize(coverFile, env.maxCoverMb, 'The cover image');
  assertCloudinaryConfigured();

  const format = BOOK_EXTENSIONS[path.extname(file.originalname).toLowerCase()];

  // Extract first so a broken file fails before anything is uploaded.
  let extracted;
  try {
    extracted = await extractBook(format, await fs.readFile(file.path), { language: fields.language });
  } catch (err) {
    throw badRequest(err.message || `Could not read this ${format.toUpperCase()} file`);
  }

  const bookId = new mongoose.Types.ObjectId();
  const folder = bookFolder(bookId);
  try {
    const fileAsset = await uploadBookFile(file.path, { publicId: `${folder}/book.${format}`, size: file.size });

    let cover;
    let coverSource = 'none';
    if (coverFile) {
      cover = await uploadFile(coverFile.path, {
        publicId: `${folder}/cover-${stamp()}`,
        resourceType: 'image',
        transformation: COVER_TRANSFORMATION,
      });
      coverSource = 'upload';
    } else if (extracted.cover) {
      cover = await uploadBuffer(extracted.cover.buffer, {
        publicId: `${folder}/cover-${stamp()}`,
        resourceType: 'image',
        transformation: COVER_TRANSFORMATION,
      }).catch(() => undefined); // an odd embedded image shouldn't block the upload
      if (cover) coverSource = 'epub';
    }
    // PDFs: the upload page renders page 1 in the browser and sends it as the cover.

    const { metadata, stats } = extracted;
    const fallbackTitle = path.parse(file.originalname).name.replace(/[_]+/g, ' ').trim();
    const book = await Book.create({
      _id: bookId,
      title: fields.title || metadata.title || fallbackTitle || 'Untitled',
      author: fields.author || metadata.author || '',
      description: fields.description || metadata.description || '',
      language: fields.language || metadata.language || '',
      tags: parseTags(fields.tags),
      category: fields.category || undefined,
      format,
      originalName: file.originalname,
      file: fileAsset,
      cover,
      coverSource,
      toc: extracted.toc,
      sectionCount: stats.sectionCount,
      wordCount: stats.wordCount,
      charCount: stats.charCount,
      uploadedBy: user._id,
    });

    await Section.insertMany(
      extracted.sections.map(({ charCount: _chars, paragraphs, ...section }, index) => ({
        ...section,
        ...packParagraphs(paragraphs),
        index,
        book: bookId,
      })),
      { ordered: false },
    );
    return book;
  } catch (err) {
    await Promise.allSettled([Book.deleteOne({ _id: bookId }), Section.deleteMany({ book: bookId }), deleteBookFolder(bookId)]);
    throw err;
  }
}

export async function replaceCover(book, coverFile) {
  if (!coverFile) throw badRequest('Choose an image to use as the cover');
  assertCloudinaryConfigured();
  const cover = await uploadFile(coverFile.path, {
    publicId: `${bookFolder(book._id)}/cover-${stamp()}`,
    resourceType: 'image',
    transformation: COVER_TRANSFORMATION,
  });
  // A PDF's generated cover points at the book file itself, so never delete that one.
  if (book.coverSource === 'upload' || book.coverSource === 'epub') await destroyAsset(book.cover);
  book.cover = cover;
  book.coverSource = 'upload';
  await book.save();
  return book;
}

export async function attachAudiobook(book, audioFile, user) {
  if (!audioFile) throw badRequest('Choose an audio file to upload');
  assertCloudinaryConfigured();
  const asset = await uploadFile(audioFile.path, {
    publicId: `${bookFolder(book._id)}/audiobook-${stamp()}-${privateSuffix()}`,
    resourceType: 'video', // Cloudinary stores audio under the "video" resource type
    size: audioFile.size,
  });
  await destroyAsset(book.audiobook);
  book.audiobook = { ...asset, originalName: audioFile.originalname, uploadedBy: user._id, uploadedAt: new Date() };
  await book.save();
  return book;
}

export async function removeAudiobook(book) {
  await destroyAsset(book.audiobook);
  book.audiobook = undefined;
  await book.save();
  return book;
}

export async function deleteBook(book) {
  await stopNarration(book._id);
  await Promise.all([
    Section.deleteMany({ book: book._id }),
    Progress.deleteMany({ book: book._id }),
    Bookmark.deleteMany({ book: book._id }),
    Assignment.deleteMany({ book: book._id }),
  ]);
  await book.deleteOne();
  await deleteBookFolder(book._id);
}
