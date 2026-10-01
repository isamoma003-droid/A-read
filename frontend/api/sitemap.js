// Vercel Function behind /sitemap.xml: lists the library and every book page for search engines.
export default async function handler(req, res) {
  const site = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const api = (process.env.VITE_API_URL || '').replace(/\/api\/?$/, '');
  try {
    const upstream = await fetch(`${api}/sitemap.xml?origin=${encodeURIComponent(site)}`);
    if (!upstream.ok) throw new Error(`API answered ${upstream.status}`);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(await upstream.text());
  } catch {
    // The API may be waking up (Render free plan); serve a minimal sitemap rather than an error.
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res
      .status(200)
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${site}/</loc></url>\n</urlset>\n`);
  }
}
