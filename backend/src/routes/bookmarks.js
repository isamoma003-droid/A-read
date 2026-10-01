import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Bookmark } from '../models/Bookmark.js';
import { notFound } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);

const updateSchema = z.object({
  label: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
});

router.patch('/:id', validate(updateSchema), async (req, res) => {
  const bookmark = await Bookmark.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: req.valid.body },
    { returnDocument: 'after' },
  );
  if (!bookmark) throw notFound('Bookmark not found');
  res.json({ bookmark });
});

router.delete('/:id', async (req, res) => {
  const result = await Bookmark.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!result.deletedCount) throw notFound('Bookmark not found');
  res.status(204).end();
});

export default router;
