// Premium books: an admin sets a price and picks chapters (sections) to lock. A reader opens them
// by paying once with M-Pesa; the uploader and admins can always open everything.
import { Payment } from '../models/Payment.js';
import { Section } from '../models/Section.js';
import { HttpError } from '../utils/httpError.js';
import { bookFolder, hasPrivateName, privateSuffix, renameAsset } from './storage.js';

export const isPremium = (book) => Boolean(book?.premium?.enabled && book.premium.lockedSections?.length);

// Ids (as strings) of the given premium books this reader has paid for.
export async function purchasedBookIds(user, books) {
  const premium = books.filter(isPremium);
  if (!user || !premium.length) return new Set();
  const ids = await Payment.distinct('book', { book: { $in: premium.map((b) => b._id) }, status: 'paid', user: user._id });
  return new Set(ids.map(String));
}

// The section indexes this reader can't open yet (empty when they can read the whole book).
export function lockedFor(book, user, purchased) {
  if (!isPremium(book) || book.canEdit(user) || purchased.has(String(book._id))) return new Set();
  return new Set(book.premium.lockedSections);
}

export async function lockedSectionsFor(book, user) {
  return lockedFor(book, user, await purchasedBookIds(user, [book]));
}

export const lockedError = (book) =>
  new HttpError(402, 'This chapter is part of the premium edition. Unlock the book to read it.', {
    code: 'PREMIUM_LOCKED',
    price: book.premium.price,
  });

// Cloudinary URLs are public and the original file holds every chapter, so when a book goes
// premium its file, audiobook and the narration of locked chapters move to unguessable names.
// Only readers who may open them are ever given the new URLs. Files that already have private
// names are left alone, so this is cheap to call on every premium change.
export async function secureBookFiles(book) {
  try {
    await secureMainFile(book);
    const audiobook = book.audiobook;
    if (audiobook?.publicId && !hasPrivateName(audiobook.publicId)) {
      const renamed = await renameAsset(audiobook.publicId, `${audiobook.publicId}-${privateSuffix()}`, 'video');
      audiobook.url = renamed.url;
      audiobook.publicId = renamed.publicId;
    }
    const sections = await Section.find({
      book: book._id,
      index: { $in: book.premium.lockedSections },
      'narration.publicId': { $exists: true },
    }).select('narration.publicId');
    for (const section of sections) {
      const from = section.narration.publicId;
      if (hasPrivateName(from)) continue;
      const renamed = await renameAsset(from, `${from}-${privateSuffix()}`, 'video');
      // Only if a narration job hasn't replaced this audio in the meantime.
      await Section.updateOne(
        { _id: section._id, 'narration.publicId': from },
        { $set: { 'narration.url': renamed.url, 'narration.publicId': renamed.publicId } },
      );
    }
  } catch (err) {
    console.warn(`Could not secure the files of book ${book._id}: ${err.message}`);
    throw new HttpError(502, `Couldn't move this book's files to a private address, so it wasn't made premium. ${err.message}`);
  }
}

async function secureMainFile(book) {
  const file = book.file;
  if (!file || hasPrivateName(file.publicId)) return;
  const publicId = `${bookFolder(book._id)}/book-${privateSuffix()}.${book.format}`;
  if (!file.parts?.length) {
    const renamed = await renameAsset(file.publicId, publicId, 'raw');
    file.url = renamed.url;
    file.publicId = renamed.publicId;
    return;
  }
  // A large book is stored in parts: move them all, or put back the ones already moved.
  const moved = [];
  try {
    for (const [i, part] of file.parts.entries()) {
      const renamed = await renameAsset(part.publicId, `${publicId}.part${i}`, 'raw');
      moved.push({ from: part.publicId, to: renamed });
    }
  } catch (err) {
    await Promise.allSettled(moved.map(({ from, to }) => renameAsset(to.publicId, from, 'raw')));
    throw err;
  }
  file.parts = moved.map(({ to }, i) => ({ url: to.url, publicId: to.publicId, bytes: file.parts[i].bytes }));
  file.url = moved[0].to.url;
  file.publicId = publicId;
}
