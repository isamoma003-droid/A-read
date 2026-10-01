import { Router } from 'express';
import mongoose from '../config/mongoose.js';
import { env } from '../config/env.js';
import { Book } from '../models/Book.js';

const router = Router();

const escapeHtml = (text = '') =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Public link for sharing on WhatsApp, Telegram, Facebook, X…: serves Open Graph tags (title,
// description, cover) for the link preview, then sends people on to the book in the app.
router.get('/books/:id', async (req, res) => {
  const target = `${env.frontendUrl}/books/${encodeURIComponent(req.params.id)}`;
  const book = mongoose.isValidObjectId(req.params.id)
    ? await Book.findById(req.params.id).select('title author description cover format wordCount')
    : null;
  if (!book) return res.redirect(302, env.frontendUrl);

  const title = book.author ? `${book.title} by ${book.author}` : book.title;
  const description =
    (book.description || '').slice(0, 200) ||
    `Read or listen to "${book.title}" on A-Read: ${book.format.toUpperCase()}, ${book.wordCount.toLocaleString()} words.`;
  const image = book.cover?.url;

  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · A-Read</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="book">
<meta property="og:site_name" content="A-Read">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(target)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">\n<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem">
<p>Opening <a href="${escapeHtml(target)}">${escapeHtml(book.title)}</a> on A-Read…</p>
<script>location.replace(${JSON.stringify(target)})</script>
</body>
</html>`);
});

export default router;
