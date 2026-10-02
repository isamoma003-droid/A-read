import { Router } from 'express';
import { z } from 'zod';
import { CATEGORY_DICTIONARY, STARTER_CATEGORIES } from '../data/categoryKeywords.js';
import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Book } from '../models/Book.js';
import { Category, slugify } from '../models/Category.js';
import { buildClassifier, dictionaryEntriesFor, ensureProfiles } from '../services/categorize.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';

const router = Router();
const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

// Public, like the rest of the catalogue: every category with how many books it holds.
router.get('/', async (_req, res) => {
  const [categories, counts] = await Promise.all([
    Category.find().collation({ locale: 'en' }).sort({ name: 1 }),
    Book.aggregate([{ $match: { category: { $ne: null } } }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
  ]);
  const byCategory = new Map(counts.map((c) => [String(c._id), c.count]));
  res.json({ categories: categories.map((c) => ({ ...c.toJSON(), books: byCategory.get(c.id) || 0 })) });
});

// --- Admin ---------------------------------------------------------------------------------

router.use(requireAuth, requireAdmin);

// "war, empire, colonial" or ["war", "empire"] -> ["war", "empire", "colonial"]
const keywords = z
  .union([z.string().max(2000), z.array(z.string().max(40)).max(50)])
  .transform((value) => [
    ...new Set(
      (Array.isArray(value) ? value : value.split(','))
        .map((k) => k.trim().toLowerCase().slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, 50));

const fields = {
  name: z.string().trim().min(1, 'Give the category a name').max(60),
  description: z.string().trim().max(300),
  keywords,
};
const createSchema = z.object({ name: fields.name, description: fields.description.default(''), keywords: fields.keywords.optional() });
const updateSchema = z.object({ name: fields.name.optional(), description: fields.description.optional(), keywords: fields.keywords.optional() });

async function save(category) {
  if (!slugify(category.name)) throw badRequest('Use at least one letter or number in the name');
  const clash = await Category.exists({ slug: slugify(category.name), _id: { $ne: category._id } });
  if (clash) throw conflict(`There is already a category called "${category.name}"`);
  await category.save();
  return category;
}

router.post('/', validate(createSchema), async (req, res) => {
  const category = await save(new Category({ ...req.valid.body, createdBy: req.user._id }));
  res.status(201).json({ category: { ...category.toJSON(), books: 0 } });
});

// Common categories the library doesn't have yet (none that an existing category already covers,
// e.g. "Fiction" when there is a "Novels" category).
router.get('/starters', async (_req, res) => {
  const existing = await Category.find().select('name');
  const covered = new Set(existing.flatMap((c) => dictionaryEntriesFor(c.name).map((e) => e.name)));
  const slugs = new Set(existing.map((c) => slugify(c.name)));
  res.json({ starters: STARTER_CATEGORIES.filter((name) => !covered.has(name) && !slugs.has(slugify(name))) });
});

const KNOWN = new Map(CATEGORY_DICTIONARY.map((e) => [e.name, e]));
router.post('/starters', validate(z.object({ names: z.array(z.string().max(60)).min(1).max(40) })), async (req, res) => {
  const unknown = req.valid.body.names.find((n) => !KNOWN.has(n));
  if (unknown) throw badRequest(`"${unknown}" isn't one of the common categories`);
  const created = [];
  for (const name of new Set(req.valid.body.names)) {
    if (await Category.exists({ slug: slugify(name) })) continue;
    created.push(await Category.create({ name, createdBy: req.user._id }));
  }
  res.status(201).json({ categories: created.map((c) => ({ ...c.toJSON(), books: 0 })) });
});

// Works out a category for each book from the book itself. Nothing changes until the admin
// applies the suggestions they keep (PUT /books).
const suggestSchema = z.object({
  // Books with no category, books A-Read filed automatically, or every book.
  scope: z.enum(['uncategorized', 'auto', 'all']).default('uncategorized'),
  limit: z.number().int().min(1).max(300).default(100),
});
router.post('/suggest', validate(suggestSchema), async (req, res) => {
  const { scope, limit } = req.valid.body;
  const categories = await Category.find();
  if (!categories.length) throw badRequest('Add a category first, then A-Read can sort books into it');
  const filter = scope === 'uncategorized' ? { category: null } : scope === 'auto' ? { categorySource: 'auto' } : {};
  const [total, books] = await Promise.all([
    Book.countDocuments(filter),
    Book.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('title author cover format tags description toc category categorySource')
      .populate('category', 'name slug'),
  ]);
  await ensureProfiles(books.map((b) => b._id));
  const profiles = new Map(
    (await Book.find({ _id: { $in: books.map((b) => b._id) } }).select('+textProfile').lean()).map((b) => [String(b._id), b.textProfile]),
  );
  const { classify } = await buildClassifier(categories, { computeMissing: true });
  res.json({
    total,
    scanned: books.length,
    suggestions: books.map((book) => {
      const { category, confidence, reasons } = classify(book, profiles.get(book.id));
      return {
        book: {
          id: book.id,
          title: book.title,
          author: book.author,
          cover: book.cover,
          format: book.format,
          category: book.category ? { id: book.category.id, name: book.category.name, slug: book.category.slug } : null,
          categorySource: book.categorySource ?? null,
        },
        suggestion: { category, confidence, reasons },
      };
    }),
  });
});

// Files books under categories in one go (categoryId null takes a book out of its category).
// Chosen by an admin, so they count as filed by a person.
const assignSchema = z.object({
  assignments: z
    .array(z.object({ bookId: objectId, categoryId: objectId.nullable() }))
    .min(1)
    .max(500),
});
router.put('/books', validate(assignSchema), async (req, res) => {
  const { assignments } = req.valid.body;
  const categoryIds = [...new Set(assignments.map((a) => a.categoryId).filter(Boolean))];
  const found = await Category.countDocuments({ _id: { $in: categoryIds } });
  if (found !== categoryIds.length) throw badRequest('One of those categories no longer exists. Refresh and try again.');
  const result = await Book.bulkWrite(
    assignments.map(({ bookId, categoryId }) => ({
      updateOne: {
        filter: { _id: bookId },
        update: categoryId ? { $set: { category: categoryId, categorySource: 'manual' } } : { $unset: { category: 1, categorySource: 1 } },
      },
    })),
  );
  res.json({ matched: result.matchedCount, updated: result.modifiedCount });
});

router.patch('/:id', validate(updateSchema), async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw notFound('Category not found');
  category.set(req.valid.body);
  await save(category);
  res.json({ category: { ...category.toJSON(), books: await Book.countDocuments({ category: category._id }) } });
});

// The books stay in the library, just without a category.
router.delete('/:id', async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw notFound('Category not found');
  await Book.updateMany({ category: category._id }, { $unset: { category: 1, categorySource: 1 } });
  await category.deleteOne();
  res.status(204).end();
});

export default router;
