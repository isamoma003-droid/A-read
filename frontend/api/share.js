// Vercel Function behind /share/books/:id (see vercel.json). It fetches the link-preview page
// from the A-Read API, so WhatsApp, Telegram, Facebook and others show the book's title and cover
// on the Vercel address, then the page sends the visitor on to /books/:id.
export default async function handler(req, res) {
  const id = String(req.query.id || '');
  const site = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const api = (process.env.VITE_API_URL || '').replace(/\/api\/?$/, '');
  if (!/^[a-f0-9]{24}$/i.test(id) || !api) return res.redirect(302, `${site}/`);
  try {
    const upstream = await fetch(`${api}/share/books/${id}?origin=${encodeURIComponent(site)}`, { redirect: 'manual' });
    if (upstream.status !== 200) return res.redirect(302, `${site}/books/${id}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
    return res.status(200).send(await upstream.text());
  } catch {
    return res.redirect(302, `${site}/books/${id}`);
  }
}
