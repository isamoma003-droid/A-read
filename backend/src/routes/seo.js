import { Router } from 'express';
import { env } from '../config/env.js';
import { Book } from '../models/Book.js';
import { Category } from '../models/Category.js';
import { authorStats, authorsForSitemap } from '../services/authors.js';
import { notFound } from '../utils/httpError.js';

const router = Router();

// URLs per sitemap file (the limit is 50,000).
const PER_FILE = 10_000;
const XML = '<?xml version="1.0" encoding="UTF-8"?>';

const escapeXml = (text) => text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
const lastmod = (date) => (date ? `<lastmod>${new Date(date).toISOString()}</lastmod>` : '');

// The frontend host proxies the sitemaps here, so URLs use FRONTEND_URL (or ?origin= from the proxy).
const originOf = (req) =>
  (typeof req.query.origin === 'string' && /^https?:\/\/[\w.-]+(:\d+)?$/.test(req.query.origin) ? req.query.origin : env.frontendUrl).replace(
    /\/$/,
    '',
  );

function sendXml(res, body) {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(`${XML}\n${body}\n`);
}

function url(loc, { updatedAt, changefreq, priority, image } = {}) {
  const imageTag = image ? `<image:image><image:loc>${escapeXml(image)}</image:loc></image:image>` : '';
  return `  <url><loc>${escapeXml(loc)}</loc>${lastmod(updatedAt)}${changefreq ? `<changefreq>${changefreq}</changefreq>` : ''}${
    priority ? `<priority>${priority}</priority>` : ''
  }${imageTag}</url>`;
}

const urlset = (urls, { images = false } = {}) =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${images ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ''}>\n${urls.join('\n')}\n</urlset>`;

// /sitemap.xml is an index of the sitemaps below: the main pages, every author and every book.
// Each lists when its pages last changed, so a new author or book is picked up on the next visit.
// Submit https://<site>/sitemap.xml once in Google Search Console; it is listed in robots.txt too.
router.get('/sitemap.xml', async (req, res) => {
  const origin = originOf(req);
  const [books, newestBook, authors] = await Promise.all([
    Book.estimatedDocumentCount(),
    Book.findOne().sort({ updatedAt: -1 }).select('updatedAt').lean(),
    authorStats(),
  ]);
  const files = [{ name: 'pages', updatedAt: newestBook?.updatedAt }];
  for (let i = 1; i <= Math.ceil(authors.count / PER_FILE); i++) files.push({ name: `authors-${i}`, updatedAt: authors.updatedAt });
  for (let i = 1; i <= Math.ceil(books / PER_FILE); i++) files.push({ name: `books-${i}`, updatedAt: newestBook?.updatedAt });
  sendXml(
    res,
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files
      .map((f) => `  <sitemap><loc>${escapeXml(`${origin}/sitemaps/${f.name}.xml`)}</loc>${lastmod(f.updatedAt)}</sitemap>`)
      .join('\n')}\n</sitemapindex>`,
  );
});

router.get('/sitemaps/:file', async (req, res) => {
  const origin = originOf(req);
  const match = /^(pages|authors|books)(?:-([1-9]\d{0,3}))?\.xml$/.exec(req.params.file);
  if (!match || (match[1] === 'pages') === Boolean(match[2])) throw notFound();
  const [, kind, number] = match;
  const skip = (Number(number) - 1) * PER_FILE;

  if (kind === 'pages') {
    // The library, the list of authors, and each category's shelf.
    const [newest, categories, counts] = await Promise.all([
      Book.findOne().sort({ updatedAt: -1 }).select('updatedAt').lean(),
      Category.find().select('slug').lean(),
      Book.aggregate([{ $match: { category: { $ne: null } } }, { $group: { _id: '$category', updatedAt: { $max: '$updatedAt' } } }]),
    ]);
    const updated = new Map(counts.map((c) => [String(c._id), c.updatedAt]));
    return sendXml(
      res,
      urlset([
        url(`${origin}/`, { updatedAt: newest?.updatedAt, changefreq: 'daily', priority: '1.0' }),
        url(`${origin}/authors`, { updatedAt: newest?.updatedAt, changefreq: 'daily', priority: '0.7' }),
        ...categories
          .filter((c) => updated.has(String(c._id)))
          .map((c) => url(`${origin}/?category=${encodeURIComponent(c.slug)}`, { updatedAt: updated.get(String(c._id)), changefreq: 'weekly', priority: '0.6' })),
      ]),
    );
  }

  if (kind === 'authors') {
    const authors = await authorsForSitemap({ skip, limit: PER_FILE });
    if (!authors.length && skip) throw notFound();
    return sendXml(
      res,
      urlset(authors.map((a) => url(`${origin}/authors/${encodeURIComponent(a.slug)}`, { updatedAt: a.updatedAt, changefreq: 'weekly', priority: '0.7' }))),
    );
  }

  const books = await Book.find().select('_id updatedAt cover.url').sort({ _id: 1 }).skip(skip).limit(PER_FILE).lean();
  if (!books.length && skip) throw notFound();
  sendXml(
    res,
    urlset(
      books.map((b) => url(`${origin}/books/${b._id}`, { updatedAt: b.updatedAt, changefreq: 'weekly', priority: '0.8', image: b.cover?.url })),
      { images: true },
    ),
  );
});

// For a single-server setup (SERVE_CLIENT=true). On Vercel, frontend/api/robots.js answers instead.
router.get('/robots.txt', (req, res) => {
  const origin = originOf(req);
  res.set('Cache-Control', 'public, max-age=86400');
  res
    .type('text/plain')
    .send(`User-agent: *\nAllow: /\nDisallow: /read/\nDisallow: /admin\nDisallow: /upload\nDisallow: /verify-email\n\nSitemap: ${origin}/sitemap.xml\n`);
});

// IndexNow checks that this site owns the key it sends (services/indexnow.js).
router.get('/indexnow-key.txt', (_req, res) => {
  if (!env.indexNowKey) throw notFound();
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('text/plain').send(env.indexNowKey);
});

export default router;
