import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import adminRoutes from './routes/admin.js';
import assignmentRoutes from './routes/assignments.js';
import authRoutes from './routes/auth.js';
import bookmarkRoutes from './routes/bookmarks.js';
import bookRoutes from './routes/books.js';
import progressRoutes from './routes/progress.js';
import seoRoutes from './routes/seo.js';
import shareRoutes from './routes/share.js';
import ttsRoutes from './routes/tts.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.clientOrigins }));
  app.use(express.json({ limit: '1mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/books', bookRoutes);
  app.use('/api/bookmarks', bookmarkRoutes);
  app.use('/api/progress', progressRoutes);
  app.use('/api/tts', ttsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/assignments', assignmentRoutes);
  app.use('/api', notFoundHandler);
  app.use('/share', shareRoutes);
  app.use(seoRoutes);

  // Optionally serve the built frontend from the same server (SERVE_CLIENT=true).
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  if (process.env.SERVE_CLIENT === 'true' && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
