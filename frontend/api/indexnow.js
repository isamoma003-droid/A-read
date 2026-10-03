// Vercel Function behind /indexnow-key.txt: IndexNow (Bing, Yandex…) checks this file to confirm
// that the A-Read API, which announces new books and authors, speaks for this site. The key itself
// is INDEXNOW_KEY on the API.
export default async function handler(req, res) {
  const api = (process.env.VITE_API_URL || '').replace(/\/api\/?$/, '');
  try {
    const upstream = await fetch(`${api}/indexnow-key.txt`);
    if (!upstream.ok) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    return res.status(200).send(await upstream.text());
  } catch {
    return res.status(503).send('Try again shortly');
  }
}
