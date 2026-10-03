import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Author } from '../models/Author.js';
import { Book } from '../models/Book.js';
import { findAuthor, listAuthors } from '../services/authors.js';
import { announce } from '../services/indexnow.js';
import { badRequest, notFound } from '../utils/httpError.js';

const router = Router();

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['name', 'books', 'recent']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(48),
});

// Public, like the rest of the catalogue: everyone named as an author, with how many books.
router.get('/', validate(listSchema, 'query'), async (req, res) => {
  res.json(await listAuthors(req.valid.query));
});

function slugOf(req) {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[\p{L}\p{N}-]{1,60}$/u.test(slug)) throw badRequest('Invalid author');
  return slug;
}

router.get('/:slug', async (req, res) => {
  const author = await findAuthor(slugOf(req));
  if (!author) throw notFound('There are no books by this author yet');
  res.json({ author });
});

const bioSchema = z.object({ bio: z.string().trim().max(3000, 'Keep the bio under 3,000 characters') });

// Admins write a short bio for an author's page.
router.put('/:slug', requireAuth, requireAdmin, validate(bioSchema), async (req, res) => {
  const slug = slugOf(req);
  if (!(await Book.exists({ 'authors.slug': slug }))) throw notFound('There are no books by this author yet');
  await Author.findOneAndUpdate({ slug }, { $set: { bio: req.valid.body.bio, updatedBy: req.user._id } }, { upsert: true });
  announce([`/authors/${slug}`]);
  res.json({ author: await findAuthor(slug) });
});

export default router;
