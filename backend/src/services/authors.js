// Author pages: anyone named in a book's author line has one at /authors/:slug, listing their
// books. Search engines find them through the sitemap (routes/seo.js), so a search for an author's
// name can lead to A-Read.
import { Author } from '../models/Author.js';
import { Book } from '../models/Book.js';
import { splitAuthors } from '../utils/authors.js';

// Books saved before author pages existed get their `authors` filled in. Run at startup.
export async function backfillAuthors() {
  const books = await Book.collection.find({ authors: { $exists: false } }, { projection: { author: 1 } }).toArray();
  if (!books.length) return 0;
  await Book.collection.bulkWrite(
    books.map((b) => ({ updateOne: { filter: { _id: b._id }, update: { $set: { authors: splitAuthors(b.author) } } } })),
  );
  return books.length;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One row per author: their name (as first written in the library), how many books, and when
// their newest book arrived or any of their books last changed.
const groupAuthors = [
  { $sort: { createdAt: 1 } },
  {
    $group: {
      _id: '$authors.slug',
      name: { $first: '$authors.name' },
      books: { $sum: 1 },
      latest: { $max: '$createdAt' },
      updatedAt: { $max: '$updatedAt' },
      cover: { $last: '$cover.url' },
    },
  },
];

const SORTS = { name: { key: 1, _id: 1 }, books: { books: -1, key: 1 }, recent: { latest: -1, _id: 1 } };

export async function listAuthors({ q, sort = 'name', page = 1, limit = 48 }) {
  const match = q ? [{ $match: { 'authors.name': new RegExp(escapeRegex(q), 'i') } }] : [];
  const [result] = await Book.aggregate([
    { $match: { 'authors.0': { $exists: true } } },
    { $unwind: '$authors' },
    ...match,
    ...groupAuthors,
    { $addFields: { key: { $toLower: '$name' } } },
    { $sort: SORTS[sort] },
    { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'n' }] } },
  ]);
  const total = result.total[0]?.n ?? 0;
  return {
    authors: result.items.map(authorJson),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function findAuthor(slug) {
  const [row] = await Book.aggregate([
    { $match: { 'authors.slug': slug } },
    { $unwind: '$authors' },
    { $match: { 'authors.slug': slug } },
    ...groupAuthors,
  ]);
  if (!row) return null;
  const profile = await Author.findOne({ slug }).lean();
  return { ...authorJson(row), bio: profile?.bio ?? '' };
}

const authorJson = (row) => ({
  slug: row._id,
  name: row.name,
  books: row.books,
  latest: row.latest,
  updatedAt: row.updatedAt,
  cover: row.cover ?? null,
});

// Every author page for the sitemap, a page at a time, with when it last changed (a book or the bio).
export async function authorsForSitemap({ skip, limit }) {
  const rows = await Book.aggregate([
    { $match: { 'authors.0': { $exists: true } } },
    { $unwind: '$authors' },
    { $group: { _id: '$authors.slug', updatedAt: { $max: '$updatedAt' } } },
    { $sort: { _id: 1 } },
    { $skip: skip },
    { $limit: limit },
  ]);
  const profiles = await Author.find({ slug: { $in: rows.map((r) => r._id) } }).select('slug updatedAt').lean();
  const bioChanged = new Map(profiles.map((p) => [p.slug, p.updatedAt]));
  return rows.map((r) => ({ slug: r._id, updatedAt: maxDate(r.updatedAt, bioChanged.get(r._id)) }));
}

export async function authorStats() {
  const [row] = await Book.aggregate([
    { $match: { 'authors.0': { $exists: true } } },
    { $unwind: '$authors' },
    { $group: { _id: '$authors.slug', updatedAt: { $max: '$updatedAt' } } },
    { $group: { _id: null, count: { $sum: 1 }, updatedAt: { $max: '$updatedAt' } } },
  ]);
  const profile = await Author.findOne().sort({ updatedAt: -1 }).select('updatedAt').lean();
  return { count: row?.count ?? 0, updatedAt: maxDate(row?.updatedAt, profile?.updatedAt) };
}

const maxDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
