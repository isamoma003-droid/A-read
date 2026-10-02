import { useSyncExternalStore } from 'react';
import { API_URL, authHeaders } from '../api/client.js';

// Books the reader has opened are kept in this Cache Storage bucket, private to the app (not a
// file the user can see or share). The service worker (public/sw.js) answers requests from it
// whenever the network is unavailable, so recently read books keep working offline.
export const OFFLINE_CACHE = 'a-read-offline-v1';
const INDEX_KEY = 'a-read-offline-index';
// How many recently opened books stay available offline, and the largest original file
// (PDF/EPUB) saved automatically. Text and narration are always saved.
const MAX_BOOKS = 10;
const MAX_AUTO_FILE_BYTES = 30 * 1024 * 1024;

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

// Books currently available offline (most recently opened first is up to the caller).
export const useOfflineBooks = () => useSyncExternalStore(subscribe, () => index);

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
 * Saves what's needed to read and listen to a book offline: details, table of contents, every
 * section's text, progress, bookmarks, cover and narration audio, plus the original file (all
 * parts) when includeFile and the audiobook when includeAudiobook.
 */
async function saveBook(book, { includeFile, includeAudiobook, onProgress } = {}) {
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
        locked: Boolean(s.locked),
      })),
    },
  };
  // Locked premium chapters come without text: keep nothing for them (and drop any copy saved
  // before the book went premium).
  for (const section of sections) {
    const url = apiUrl(`/books/${book.id}/sections/${section.index}`);
    if (section.locked) await cache.delete(url);
    else jsonUrls[url] = { section };
  }

  const apiGets = [`/progress/${book.id}`, `/books/${book.id}/bookmarks`, `/books/${book.id}/narration`, '/auth/me'].map(apiUrl);
  const bookFile = full.file?.parts?.length ? full.file.parts.map((p) => p.url) : full.file?.url ? [full.file.url] : [];
  const fileIncluded = includeFile ?? (full.file?.bytes || 0) <= MAX_AUTO_FILE_BYTES;
  const files = [
    ...(fileIncluded ? bookFile : []),
    full.cover?.url,
    includeAudiobook ? full.audiobook?.url : null,
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
      hasAudiobook: Boolean(includeAudiobook && full.audiobook?.url),
      hasFile: fileIncluded && bookFile.length > 0,
      bookUpdatedAt: full.updatedAt,
      unlocked: full.unlocked !== false,
      bytes,
      urls,
      savedAt: new Date().toISOString(),
      openedAt: new Date().toISOString(),
    },
  });
  await evictOldest();
}

const inFlight = new Map();

/**
 * Called when a book is opened (and when its audiobook is played). Quietly keeps the book
 * available offline, refreshing it if it changed, and forgets the least recently opened
 * books beyond MAX_BOOKS. Never throws.
 */
export function keepBookOffline(book, { audiobook = false } = {}) {
  if (!offlineSupported || !navigator.onLine || !book?.id) return Promise.resolve();
  const saved = index[book.id];
  const upToDate =
    saved &&
    saved.bookUpdatedAt === book.updatedAt &&
    // Paying for a premium book doesn't change the book itself, but opens chapters to save.
    (saved.unlocked ?? true) === (book.unlocked !== false) &&
    (!audiobook || saved.hasAudiobook || !book.audiobook);
  if (upToDate) {
    writeIndex({ ...index, [book.id]: { ...saved, openedAt: new Date().toISOString() } });
    return Promise.resolve();
  }
  const running = inFlight.get(book.id);
  const unlocked = book.unlocked !== false;
  if (running) {
    // A save of the same version is already going. If the book changed meanwhile (edited, or the
    // reader just paid for it), check again once that save is done.
    if (running.updatedAt === book.updatedAt && running.unlocked === unlocked && (!audiobook || running.audiobook)) return running.job;
    return running.job.then(() => keepBookOffline(book, { audiobook }));
  }
  const includeAudiobook = audiobook || Boolean(saved?.hasAudiobook);
  const job = saveBook(book, { includeAudiobook })
    .catch(() => {})
    .finally(() => inFlight.delete(book.id));
  inFlight.set(book.id, { job, updatedAt: book.updatedAt, unlocked, audiobook: includeAudiobook });
  return job;
}

async function evictOldest() {
  const entries = Object.values(index).sort((a, b) => (b.openedAt || b.savedAt).localeCompare(a.openedAt || a.savedAt));
  for (const entry of entries.slice(MAX_BOOKS)) await forgetBook(entry.id);
}

async function forgetBook(bookId) {
  const entry = index[bookId];
  if (!entry) return;
  const cache = await caches.open(OFFLINE_CACHE);
  // Keep shared entries (e.g. /auth/me) if another saved book still lists them.
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


// Forgets every saved book (used on log out, so the next person on a shared device doesn't
// inherit them).
export async function clearOfflineBooks() {
  writeIndex({});
  try {
    localStorage.removeItem('a-read-pending-progress');
  } catch {
    // ignore
  }
  if (offlineSupported) await caches.delete(OFFLINE_CACHE).catch(() => {});
}
