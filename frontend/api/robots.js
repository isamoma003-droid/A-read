// Vercel Function behind /robots.txt so the sitemap URL always matches the site's domain.
export default function handler(req, res) {
  const site = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400');
  res.status(200).send(`User-agent: *\nAllow: /\nDisallow: /read/\nDisallow: /admin\nDisallow: /upload\nDisallow: /verify-email\n\nSitemap: ${site}/sitemap.xml\n`);
}
