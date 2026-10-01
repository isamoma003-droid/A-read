import { useSyncExternalStore } from 'react';
import { API_URL, authHeaders } from '../api/client.js';

// Downloaded books live in this Cache Storage bucket. The service worker (public/sw.js) answers
// requests from it whenever the network is unavailable, so the normal reader works offline.
export const OFFLINE_CACHE = 'a-read-offline-v1';
const INDEX_KEY = 'a-read-offline-index';

export const offlineSupported = typeof window !== 'undefined' && 'caches' in window && 'serviceWorker' in navigator;

// --- Index of downloaded books (localStorage) -------------------------------------------------

let index = readIndex();
const listeners = new Set();

function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeIndex(next) {
  index = next;
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked; the in-memory index still works for this session.
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const useDownloads = () => useSyncExternalStore(subscribe, () => index);
export const getDownload = (bookId) => index[bookId] || null;

// --- Downloading ------------------------------------------------------------------------------

const apiUrl = (path) => `${API_URL}${path}`;

async function put(cache, url, response) {
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  await cache.put(url, response);
}

const jsonResponse = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

// Warms the service worker cache with the reader's code so it opens offline even if it
// was never used online on this device.
async function prefetchReaderCode(format) {
  const loads = [import('../pages/ReaderPage.jsx')];
  if (format === 'pdf') loads.push(import('../reader/PdfView.jsx'));
  if (format === 'epub') loads.push(import('../reader/EpubView.jsx'));
  await Promise.allSettled(loads);
  if (format === 'pdf') {
    await fetch(new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url)).catch(() => {});
  }
}

/**
 * Saves everything needed to read and listen to a book offline: details, table of contents,
 * every section's text, progress, bookmarks, the original file (all parts), cover, narration
 * audio and the audiobook. Calls onProgress({ done, total }) as files finish.
 */
export async function downloadBook(book, { onProgress } = {}) {
  if (!offlineSupported) throw new Error('This browser cannot save books for offline use');
  navigator.storage?.persist?.().catch(() => {});
  const cache = await caches.open(OFFLINE_CACHE);
  const headers = authHeaders();
  const get = (url) => fetch(url, { headers, cache: 'no-store' });

  const fresh = await get(apiUrl(`/books/${book.id}`)).then((r) => r.json());
  const full = fresh.book || book;
  const { sections } = await get(apiUrl(`/books/${book.id}/offline`)).then((r) => r.json());

  // Requests the reader makes, saved under the same URLs.
  const jsonUrls = {
    [apiUrl(`/books/${book.id}`)]: fresh,
    [apiUrl(`/books/${book.id}/sections`)]: {
      sections: sections.map((s) => ({
        index: s.index,
        title: s.title,
        href: s.href,
        wordCount: s.wordCount,
        sentenceCount: s.sentenceCount,
        narrationDuration: s.narration?.duration ?? null,
      })),
    },
  };
  for (const section of sections) jsonUrls[apiUrl(`/books/${book.id}/sections/${section.index}`)] = { section };

  const apiGets = [`/progress/${book.id}`, `/books/${book.id}/bookmarks`, `/books/${book.id}/narration`, '/auth/me'].map(apiUrl);
  const files = [
    ...(full.file?.parts?.length ? full.file.parts.map((p) => p.url) : full.file?.url ? [full.file.url] : []),
    full.cover?.url,
    full.audiobook?.url,
    ...sections.map((s) => s.narration?.url),
  ].filter(Boolean);

  const total = Object.keys(jsonUrls).length + apiGets.length + files.length + 1;
  let done = 0;
  const tick = () => onProgress?.({ done: ++done, total });

  const urls = [];
  try {
    for (const [url, data] of Object.entries(jsonUrls)) {
      await cache.put(url, jsonResponse(data));
      urls.push(url);
      tick();
    }
    for (const url of apiGets) {
      const res = await get(url).catch(() => null);
      if (res?.ok) {
        await cache.put(url, res);
        urls.push(url);
      }
      tick();
    }
    // Files: a few at a time.
    const queue = [...files];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const url = queue.shift();
          await put(cache, url, await fetch(url, { mode: 'cors' }));
          urls.push(url);
          tick();
        }
      }),
    );
    await prefetchReaderCode(full.format);
    tick();
  } catch (err) {
    await Promise.all(urls.map((url) => cache.delete(url)));
    throw err;
  }

  let bytes = 0;
  for (const url of urls) {
    const res = await cache.match(url);
    bytes += Number(res?.headers.get('content-length')) || (await res?.clone().blob())?.size || 0;
  }

  writeIndex({
    ...index,
    [book.id]: {
      id: book.id,
      title: full.title,
      author: full.author,
      format: full.format,
      cover: full.cover,
      hasNarration: sections.some((s) => s.narration?.url),
      hasAudiobook: Boolean(full.audiobook?.url),
      bytes,
      urls,
      savedAt: new Date().toISOString(),
    },
  });
}

export async function removeDownload(bookId) {
  const entry = index[bookId];
  if (!entry) return;
  const cache = await caches.open(OFFLINE_CACHE);
  // Keep shared entries (e.g. /auth/me) if another download still lists them.
  const stillUsed = new Set(Object.values(index).filter((e) => e.id !== bookId).flatMap((e) => e.urls));
  await Promise.all(entry.urls.filter((url) => !stillUsed.has(url)).map((url) => cache.delete(url)));
  const { [bookId]: _removed, ...rest } = index;
  writeIndex(rest);
}

// Keeps the offline copy of a book's progress in step, so reopening it offline resumes correctly.
export async function updateOfflineProgress(bookId, progress) {
  if (!index[bookId] || !offlineSupported) return;
  const cache = await caches.open(OFFLINE_CACHE);
  const url = apiUrl(`/progress/${bookId}`);
  const old = await cache.match(url, { ignoreVary: true }).then((r) => r?.json()).catch(() => null);
  await cache.put(url, jsonResponse({ progress: { ...(old?.progress || {}), ...progress, book: bookId } }));
  if (!index[bookId].urls.includes(url)) writeIndex({ ...index, [bookId]: { ...index[bookId], urls: [...index[bookId].urls, url] } });
}

export async function storageEstimate() {
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

// Removes every downloaded book from this device (used on log out, so the next person on a
// shared device doesn't inherit them).
export async function clearDownloads() {
  writeIndex({});
  try {
    localStorage.removeItem('a-read-pending-progress');
  } catch {
    // ignore
  }
  if (offlineSupported) await caches.delete(OFFLINE_CACHE).catch(() => {});
}
