import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { listVoices } from '../services/narration.js';

const router = Router();
router.use(requireAuth);

router.get('/status', (_req, res) => {
  res.json({ enabled: env.googleTtsEnabled, defaultVoice: env.defaultTtsVoice, maxChars: env.narrationMaxChars });
});

router.get('/voices', async (req, res) => {
  const language = typeof req.query.language === 'string' ? req.query.language.slice(0, 10) : undefined;
  res.json({ voices: await listVoices(language) });
});

export default router;
