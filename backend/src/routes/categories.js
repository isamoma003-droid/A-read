import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Book } from '../models/Book.js';
import { Category, slugify } from '../models/Category.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';

const router = Router();

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

const fields = {
  name: z.string().trim().min(1, 'Give the category a name').max(60),
  description: z.string().trim().max(300),
};
const createSchema = z.object({ name: fields.name, description: fields.description.default('') });
const updateSchema = z.object({ name: fields.name.optional(), description: fields.description.optional() });

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
  await Book.updateMany({ category: category._id }, { $unset: { category: 1 } });
  await category.deleteOne();
  res.status(204).end();
});

export default router;
