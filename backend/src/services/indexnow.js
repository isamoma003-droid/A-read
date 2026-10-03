// IndexNow (https://www.indexnow.org) lets a site tell Bing, Yandex, Seznam, Naver and the other
// engines that share it about new or changed pages straight away, instead of waiting to be
// crawled. Google doesn't use it; Google finds new books and authors through the sitemap.
//
// Pages are collected for a few seconds and sent together, so a batch upload is one request.
import { env } from '../config/env.js';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const WAIT_MS = 5_000;

const send = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
let transport = send;
// Tests swap in a stand-in.
export function setIndexNowTransport(fn) {
  transport = fn || send;
}

// IndexNow only accepts pages on the site that serves the key file (FRONTEND_URL, over HTTPS).
export const indexNowEnabled = () => Boolean(env.indexNowKey) && /^https:\/\/[^/]+$/.test(env.frontendUrl);

const pending = new Set();
let timer = null;

// `paths` like "/books/<id>" or "/authors/<slug>".
export function announce(paths) {
  if (!indexNowEnabled()) return;
  for (const path of paths) pending.add(`${env.frontendUrl}${path}`);
  if (!timer) {
    timer = setTimeout(() => flushIndexNow().catch(() => {}), WAIT_MS);
    timer.unref?.();
  }
}

export async function flushIndexNow() {
  clearTimeout(timer);
  timer = null;
  if (!pending.size) return null;
  const urlList = [...pending].slice(0, 10_000);
  pending.clear();
  const body = {
    host: new URL(env.frontendUrl).host,
    key: env.indexNowKey,
    keyLocation: `${env.frontendUrl}/indexnow-key.txt`,
    urlList,
  };
  try {
    const res = await transport(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    // 200 and 202 both mean received; 403 means the key file couldn't be checked yet.
    if (res.status >= 300) console.warn(`IndexNow answered ${res.status} for ${urlList.length} page(s)`);
    return res.status;
  } catch (err) {
    console.warn(`Could not reach IndexNow: ${err.message}`);
    return null;
  }
}

// The pages a book appears on: its own and each of its authors'.
export const bookPages = (book) => [`/books/${book._id ?? book.id}`, ...(book.authors || []).map((a) => `/authors/${a.slug}`)];
