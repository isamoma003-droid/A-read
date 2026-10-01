// A-Read service worker: makes the app installable, keeps the app shell (HTML, JS, CSS, icons,
// fonts) available offline, and serves books the reader chose to download (see
// src/offline/store.js) when there's no connection.
const VERSION = 'a-read-v2';
const OFFLINE = 'a-read-offline-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION && n !== OFFLINE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Answers a request from a saved response, honouring Range headers (audio seeking, PDF streaming).
async function fromSaved(request, saved) {
  const range = request.headers.get('range');
  if (!range) return saved;
  const blob = await saved.blob();
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) return saved;
  const size = blob.size;
  let start = match[1] === '' ? size - Number(match[2]) : Number(match[1]);
  let end = match[1] !== '' && match[2] !== '' ? Number(match[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': saved.headers.get('content-type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

async function savedMatch(request) {
  const cache = await caches.open(OFFLINE);
  return cache.match(request.url, { ignoreVary: true, ignoreSearch: false });
}

// Downloaded books: book files, covers and audio are immutable, so the saved copy is used
// first. API data is fetched fresh when possible and falls back to the saved copy offline.
async function handleSaved(event) {
  const { request } = event;
  const saved = await savedMatch(request);
  if (!saved) return null;
  const isApi = /\/api\//.test(new URL(request.url).pathname);
  if (!isApi) return fromSaved(request, saved);
  try {
    return await fetch(request);
  } catch {
    return saved;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.endsWith('.xml') || url.pathname.startsWith('/share/')) return;

  // Anything saved for offline reading (any origin) is served from the offline store.
  event.respondWith(
    handleSaved(event).then((response) => response || handleDefault(event, request, url)),
  );
});

function handleDefault(event, request, url) {
  const sameOrigin = url.origin === self.location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  // API, Cloudinary files, Google sign-in: straight to the network.
  if ((!sameOrigin && !isFont) || (sameOrigin && (url.pathname.startsWith('/api/') || /\.(xml|txt)$/.test(url.pathname)))) {
    return fetch(request);
  }

  // Pages: network first, falling back to the cached app shell when offline.
  if (request.mode === 'navigate') {
    return fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put('/', copy));
        return response;
      })
      .catch(() => caches.match('/'));
  }

  // Built assets are content-hashed, so cache-first is safe.
  return caches.match(request).then(
    (cached) =>
      cached ||
      fetch(request).then((response) => {
        if (response.ok && (isFont || url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname))) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }),
  );
}
