// Premium books: an admin sets a price and picks chapters (sections) to lock. A reader opens them
// by paying once with M-Pesa; the uploader and admins can always open everything.
import { Book } from '../models/Book.js';
import { Payment } from '../models/Payment.js';
import { Section } from '../models/Section.js';
import { HttpError } from '../utils/httpError.js';
import { hasActivePass } from './pass.js';
import { bookFolder, hasPrivateName, privateSuffix, renameAsset } from './storage.js';

export const isPremium = (book) => Boolean(book?.premium?.enabled && book.premium.lockedSections?.length);

// Ids (as strings) of the given premium books this reader has paid for. A Premium Pass opens all
// of them while it lasts.
export async function purchasedBookIds(user, books) {
  const premium = books.filter(isPremium);
  if (!user || !premium.length) return new Set();
  if (await hasActivePass(user)) return new Set(premium.map((b) => String(b._id)));
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

// Only one unlock payment may wait for M-Pesa per reader and book (Payment's one_pending_unlock
// index). A database with several from before that rule keeps the newest of each waiting and marks
// the rest failed (a late success still settles them), then builds the index. Run at startup.
export async function ensureUnlockIndex() {
  const groups = await Payment.aggregate([
    { $match: { status: 'pending', book: { $exists: true } } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: { user: '$user', book: '$book' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  const older = groups.flatMap((g) => g.ids.slice(1));
  if (older.length) {
    await Payment.updateMany({ _id: { $in: older }, status: 'pending' }, { $set: { status: 'failed', resultDesc: 'Replaced by a newer attempt' } });
  }
  await Payment.createIndexes();
  return older.length;
}

export const lockedError = (book) =>
  new HttpError(402, 'This chapter is part of the premium edition. Unlock the book to read it.', {
    code: 'PREMIUM_LOCKED',
    price: book.premium.price,
  });

// Cloudinary URLs are public and the original file holds every chapter, so when a book goes
// premium its file, audiobook and the narration of locked chapters move to fresh, unguessable
// names. Only readers who may open them are ever given the new URLs.
//
// `previous` is the book's premium settings before this change. Readers were given the file and
// audiobook URLs while the book was free, so going premium (from free) always moves them, even if
// their names already look private; the same goes for the narration of newly locked chapters.
// While a book stays premium, files with private names were only ever given to readers who could
// open them, so they stay put.
//
// Each move is written to MongoDB as soon as it's done, so a failure part-way leaves the book
// consistent (still free, files where the database says) and a retry carries on from there.
export async function secureBookFiles(book, previous) {
  const wasPremium = isPremium({ premium: previous });
  const lockedBefore = new Set(wasPremium ? previous.lockedSections : []);
  const mustMove = (publicId, handedOut) => handedOut || !hasPrivateName(publicId);
  try {
    if (book.file && mustMove(book.file.publicId, !wasPremium)) await moveMainFile(book);

    const audiobook = book.audiobook;
    if (audiobook?.publicId && mustMove(audiobook.publicId, !wasPremium)) {
      const from = audiobook.publicId;
      const renamed = await renameAsset(from, freshName(from), audiobook.resourceType || 'video');
      await Book.updateOne(
        { _id: book._id, 'audiobook.publicId': from },
        { $set: { 'audiobook.url': renamed.url, 'audiobook.publicId': renamed.publicId } },
      );
      audiobook.url = renamed.url;
      audiobook.publicId = renamed.publicId;
    }

    const sections = await Section.find({
      book: book._id,
      index: { $in: book.premium.lockedSections },
      'narration.publicId': { $exists: true },
    }).select('index narration.publicId');
    for (const section of sections) {
      const from = section.narration.publicId;
      if (!mustMove(from, !lockedBefore.has(section.index))) continue;
      const renamed = await renameAsset(from, freshName(from), 'video');
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

// "…/audiobook-x-<old suffix>" -> "…/audiobook-x-<new suffix>"
const freshName = (publicId) => `${publicId.replace(/-[0-9a-f]{24}$/, '')}-${privateSuffix()}`;

// Moves the original file (or all its parts) to a new private name and records it, or puts
// everything back if any step fails.
async function moveMainFile(book) {
  const file = book.file;
  const type = file.resourceType || 'raw';
  const publicId = `${bookFolder(book._id)}/book-${privateSuffix()}.${book.format}`;
  const pieces = file.parts?.length
    ? file.parts.map((part, i) => ({ from: part.publicId, to: `${publicId}.part${i}`, bytes: part.bytes }))
    : [{ from: file.publicId, to: publicId }];
  const moved = [];
  try {
    for (const piece of pieces) moved.push({ ...piece, renamed: await renameAsset(piece.from, piece.to, type) });
    const next = file.parts?.length
      ? {
          url: moved[0].renamed.url,
          publicId,
          parts: moved.map((m) => ({ url: m.renamed.url, publicId: m.renamed.publicId, bytes: m.bytes })),
        }
      : { url: moved[0].renamed.url, publicId: moved[0].renamed.publicId };
    const result = await Book.updateOne(
      { _id: book._id, 'file.publicId': file.publicId },
      { $set: Object.fromEntries(Object.entries(next).map(([key, value]) => [`file.${key}`, value])) },
    );
    if (!result.matchedCount) throw new Error('the book changed while its file was being moved; try again');
    Object.assign(file, next);
  } catch (err) {
    await Promise.allSettled(moved.map((m) => renameAsset(m.renamed.publicId, m.from, type)));
    throw err;
  }
}
