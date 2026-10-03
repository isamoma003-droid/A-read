// Vercel Function behind /sitemap.xml and /sitemaps/*.xml (see vercel.json): the sitemap index
// and the sitemaps it lists (main pages, authors, books), fetched from the A-Read API so every URL
// uses this site's address.
export default async function handler(req, res) {
  const site = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const api = (process.env.VITE_API_URL || '').replace(/\/api\/?$/, '');
  const file = String(req.query.file || '');
  const child = /^(pages|(authors|books)-[1-9]\d{0,3})\.xml$/.test(file);
  if (file && !child) return res.status(404).send('Not found');
  const path = child ? `/sitemaps/${file}` : '/sitemap.xml';
  try {
    const upstream = await fetch(`${api}${path}?origin=${encodeURIComponent(site)}`);
    if (upstream.status === 404) return res.status(404).send('Not found');
    if (!upstream.ok) throw new Error(`API answered ${upstream.status}`);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(await upstream.text());
  } catch {
    // The API may be waking up (Render free plan). The index falls back to the home page alone; a
    // listed sitemap asks search engines to come back shortly rather than look empty.
    if (child) {
      res.setHeader('Retry-After', '120');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).send('The library is waking up, try again in a minute');
    }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res
      .status(200)
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${site}/</loc></url>\n</urlset>\n`);
  }
}
