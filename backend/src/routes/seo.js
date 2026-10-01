import { Router } from 'express';
import { env } from '../config/env.js';
import { Book } from '../models/Book.js';

const router = Router();

const escapeXml = (text) => text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

// sitemap.xml for search engines: the library home plus every public book page.
// The frontend host proxies /sitemap.xml here, so URLs use FRONTEND_URL (or ?origin= from the proxy).
router.get('/sitemap.xml', async (req, res) => {
  const origin = (typeof req.query.origin === 'string' && /^https?:\/\/[\w.-]+(:\d+)?$/.test(req.query.origin)
    ? req.query.origin
    : env.frontendUrl
  ).replace(/\/$/, '');
  const books = await Book.find().select('_id updatedAt').sort({ updatedAt: -1 }).limit(50000).lean();
  const newest = books[0]?.updatedAt;
  const urls = [
    `  <url><loc>${escapeXml(origin)}/</loc>${newest ? `<lastmod>${newest.toISOString()}</lastmod>` : ''}<changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...books.map(
      (b) =>
        `  <url><loc>${escapeXml(`${origin}/books/${b._id}`)}</loc><lastmod>${new Date(b.updatedAt).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    ),
  ];
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
});

export default router;
