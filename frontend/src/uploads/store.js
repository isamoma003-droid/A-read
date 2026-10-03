import { useSyncExternalStore } from 'react';
import { api, upload } from '../api/client.js';
import { keys } from '../api/queries.js';
import { pdfCoverFromFile } from '../utils/pdfCover.js';
import * as saved from './saved.js';

// The upload queue lives here rather than in the upload page, so uploads keep going while the
// reader browses the rest of the app. It's also saved in IndexedDB (saved.js): after a reload or
// a closed tab, the queue comes back and a batch that was running carries on by itself. Each file
// has a random upload key, so one that reached the server just before the reload is never added
// to the library twice (the server hands the existing book back).

export const BOOK_TYPES = '.pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain';
export const MAX_MB = Number(import.meta.env.VITE_MAX_BOOK_MB || 100);
export const MAX_FILES = 20;
// Statuses: queued → preparing (PDF cover) → uploading → processing → done, or error; "missing"
// when the browser couldn't keep the file across a reload and it has to be chosen again.
export const ACTIVE = ['preparing', 'uploading', 'processing'];
const KEEP_DONE_MS = 24 * 60 * 60 * 1000;
// How long the server may still be reading a book whose file had fully arrived when the page went
// away, before we send the file again.
const SERVER_WORK_MS = 3 * 60 * 1000;
const CHECK_EVERY_MS = 4000;
const LOCK = 'a-read-uploads';
const DRAFT_COVER = 'draft:cover';
const EMPTY_DRAFT = { title: '', author: '', description: '', tags: '', language: '', category: '' };

export const extension = (name) => name.slice(name.lastIndexOf('.')).toLowerCase();

const newKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

let state = {
  owner: null, // the account these uploads belong to
  items: [],
  draft: EMPTY_DRAFT, // the details form
  cover: null, // cover image chosen for a single book
  running: false,
  elsewhere: false, // another tab is running this queue
  restored: false, // the queue came back after a reload
  batch: 0, // counts batches that have ended
  lastBatch: null, // { single, books } of the batch that ended last
  unseen: false, // a batch ended while the upload page wasn't open
};
const listeners = new Set();
const controllers = new Map();
let queryClient = null;

function set(change) {
  state = { ...state, ...change };
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const useUploads = () => useSyncExternalStore(subscribe, () => state);

// main.jsx hands over the query client so finished uploads show up in the library at once.
export function configureUploads(options) {
  queryClient = options.queryClient;
}

// --- Saving ----------------------------------------------------------------------------------

// What's kept for each upload (the file itself is stored separately, once).
const record = ({ id, name, size, type, lastModified, status, error, retryable, book, fields, addedAt, updatedAt, sentAt }) => ({
  id,
  name,
  size,
  type,
  lastModified,
  status,
  error,
  retryable,
  book,
  fields,
  addedAt,
  updatedAt,
  sentAt,
});

let metaTimer = null;
function saveMeta({ now = false } = {}) {
  clearTimeout(metaTimer);
  const write = () => state.owner && saved.writeMeta({ owner: state.owner, draft: state.draft, running: state.running });
  if (now) write();
  else metaTimer = setTimeout(write, 300);
}

const find = (id) => state.items.find((i) => i.id === id);
// Only a signed-in account's uploads are saved.
const owned = () => Boolean(state.owner);

function patch(id, change) {
  const before = find(id);
  if (!before) return;
  const after = { ...before, ...change, updatedAt: Date.now() };
  set({ items: state.items.map((i) => (i.id === id ? after : i)) });
  // Progress ticks aren't worth a write; status changes are.
  const statusChanged = 'status' in change && change.status !== before.status;
  if (owned() && (statusChanged || 'fields' in change || 'book' in change)) saved.writeItem(record(after));
}

// --- What the upload page calls ---------------------------------------------------------------

// Adds books to the queue (finished ones from an earlier batch make way). A file that has to be
// chosen again after a reload is matched by name and size. Returns the files that were refused.
export function addFiles(fileList) {
  const rejected = [];
  const finished = state.items.filter((i) => i.status === 'done');
  let kept = state.items.filter((i) => i.status !== 'done');
  const accepted = [];
  const now = Date.now();
  for (const file of fileList) {
    const lost = kept.find((i) => i.status === 'missing' && i.name === file.name && i.size === file.size);
    if (lost) {
      const found = { ...lost, file, status: 'queued', error: null };
      kept = kept.map((i) => (i.id === lost.id ? found : i));
      persistFile(found);
      continue;
    }
    if (!['.pdf', '.epub', '.txt'].includes(extension(file.name))) rejected.push(`${file.name} (not PDF/EPUB/TXT)`);
    else if (file.size > MAX_MB * 1024 * 1024) rejected.push(`${file.name} (over ${MAX_MB} MB)`);
    else {
      accepted.push({
        id: newKey(),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        status: 'queued',
        progress: 0,
        // Distinct per file so the list keeps its order after a reload.
        addedAt: now + accepted.length,
        updatedAt: now,
      });
    }
  }
  const room = Math.max(0, MAX_FILES - kept.length);
  if (accepted.length > room) rejected.push(`${accepted.length - room} more (up to ${MAX_FILES} at a time)`);
  const added = accepted.slice(0, room);
  set({ items: [...kept, ...added], unseen: false, restored: state.restored && kept.length > 0 });
  for (const item of finished) saved.deleteItem(item.id);
  if (owned()) {
    for (const item of [...kept, ...added]) saved.writeItem(record(item));
    for (const item of added) persistFile(item);
    saveMeta();
  }
  return rejected;
}

// Keeps the file for after a reload. If the browser won't (no room), the upload still runs now.
async function persistFile(item) {
  if (!owned()) return;
  const ok = await saved.writeFile(item.id, item.file);
  if (!ok) console.warn(`Couldn't keep "${item.name}" in case the page reloads (browser storage is full)`);
}

export function removeItem(id) {
  controllers.get(id)?.abort();
  set({ items: state.items.filter((i) => i.id !== id) });
  saved.deleteItem(id);
}

export function updateDraft(change) {
  set({ draft: { ...state.draft, ...change } });
  saveMeta();
}

export function setCover(file) {
  set({ cover: file });
  if (owned()) saved.writeFile(DRAFT_COVER, file);
}

// "Upload more": clear the finished list and the details that belonged to one book.
export function clearFinished() {
  for (const item of state.items.filter((i) => i.status === 'done')) saved.deleteItem(item.id);
  set({ items: state.items.filter((i) => i.status !== 'done'), draft: { ...state.draft, title: '', author: '', description: '' }, restored: false });
  setCover(null);
  saveMeta();
}

export const markSeen = () => state.unseen && set({ unseen: false });

// Starts (or retries) the queue with the details form as it is now. Title, author, description
// and the cover only apply when there is a single book.
export function startUploads() {
  if (state.running) return;
  const single = state.items.length === 1;
  const { title, author, description, ...shared } = state.draft;
  const chosen = { ...shared, ...(single ? { title, author, description } : {}) };
  const fields = Object.fromEntries(
    Object.entries(chosen)
      .map(([key, value]) => [key, String(value ?? '').trim()])
      .filter(([, value]) => value),
  );
  for (const item of state.items) {
    if (item.status !== 'queued' && item.status !== 'error') continue;
    patch(item.id, { status: 'queued', error: null, retryable: false, fields, cover: single ? state.cover : null });
    if (single && state.cover && owned()) saved.writeFile(`${item.id}:cover`, state.cover);
  }
  run();
}

// --- The runner -------------------------------------------------------------------------------

// One tab at a time runs the queue (they share what's saved). Another tab that finds it busy
// leaves it alone and says so.
let starting = false;
function run() {
  if (starting || state.running || !state.owner) return;
  starting = true;
  const job = navigator.locks
    ? navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock) return set({ elsewhere: true });
        set({ elsewhere: false });
        await runQueue();
      })
    : runQueue();
  Promise.resolve(job)
    .catch(() => {})
    .finally(() => {
      starting = false;
    });
}

async function runQueue() {
  const owner = state.owner;
  const single = state.items.length === 1;
  const created = [];
  set({ running: true });
  saveMeta({ now: true });
  try {
    created.push(...(await settleInterrupted()));
    for (let item = nextItem(); item && state.owner === owner; item = nextItem()) {
      const book = await send(item);
      if (book) created.push(book);
    }
  } finally {
    if (state.owner === owner) {
      set({ running: false, batch: state.batch + 1, unseen: true, lastBatch: { single, books: created.map((b) => b.id) } });
      saveMeta({ now: true });
      if (created.length) {
        queryClient?.invalidateQueries({ queryKey: ['books'] });
        queryClient?.invalidateQueries({ queryKey: keys.tags });
        queryClient?.invalidateQueries({ queryKey: keys.categories });
        queryClient?.invalidateQueries({ queryKey: ['authors'] });
      }
    }
  }
}

const nextItem = () => state.items.find((i) => i.status === 'queued' && i.file);

// After a reload, some uploads may have reached the server just before the page went away. Ask
// which ones are already in the library before sending anything again. A file that had fully
// arrived is probably still being read there, so wait for it a little (rather than sending, say,
// 100 MB again over mobile data); if it doesn't turn up, it's sent again.
// Resolves to the books found.
async function settleInterrupted() {
  const owner = state.owner;
  let waiting = state.items.filter((i) => i.interrupted && i.status !== 'done');
  const found = [];
  if (!waiting.length) return found;
  const all = new Set(waiting.map((i) => i.id));
  for (;;) {
    try {
      const { books } = await api(`/books/uploads?keys=${waiting.map((i) => i.id).join(',')}`);
      for (const item of waiting) {
        if (!books[item.id]) continue;
        finish(item.id, books[item.id]);
        found.push(books[item.id]);
      }
      waiting = waiting.filter((i) => !books[i.id]);
    } catch {
      // Offline or the server is waking up: sending again is still safe (same upload keys).
    }
    const reading = waiting.filter((i) => i.sentAt && Date.now() - i.sentAt < SERVER_WORK_MS);
    if (!reading.length || state.owner !== owner) break;
    for (const item of reading) if (find(item.id)?.status !== 'processing') patch(item.id, { status: 'processing', progress: 1 });
    await new Promise((resolve) => setTimeout(resolve, CHECK_EVERY_MS));
    waiting = waiting.filter((i) => find(i.id));
  }
  set({
    items: state.items.map((i) =>
      all.has(i.id) && i.status !== 'done'
        ? { ...i, interrupted: false, ...(i.status === 'processing' ? { status: i.file ? 'queued' : 'missing', progress: 0, sentAt: null } : {}) }
        : i,
    ),
  });
  return found;
}

function finish(id, book) {
  queryClient?.setQueryData(keys.book(book.id), book);
  patch(id, { status: 'done', progress: 1, book: { id: book.id, title: book.title }, file: null, cover: null, error: null });
  saved.deleteFiles(id);
}

async function send(item) {
  const controller = new AbortController();
  controllers.set(item.id, controller);
  try {
    const form = new FormData();
    for (const [key, value] of Object.entries(item.fields || {})) form.append(key, value);
    form.append('uploadKey', item.id);
    form.append('file', item.file);
    let cover = item.cover;
    if (!cover && extension(item.name) === '.pdf') {
      patch(item.id, { status: 'preparing' });
      cover = await pdfCoverFromFile(item.file);
      if (controller.signal.aborted) return null;
    }
    if (cover) form.append('cover', cover);

    patch(item.id, { status: 'uploading', progress: 0, error: null, sentAt: null });
    const { book } = await upload('/books', form, {
      signal: controller.signal,
      onProgress: (p) =>
        patch(item.id, p >= 1 ? { progress: 1, status: 'processing', sentAt: find(item.id)?.sentAt ?? Date.now() } : { progress: p, status: 'uploading' }),
    });
    finish(item.id, book);
    return book;
  } catch (err) {
    if (err.name !== 'AbortError') patch(item.id, { status: 'error', error: err.message, retryable: !err.status });
    return null;
  } finally {
    controllers.delete(item.id);
  }
}

// --- Account changes --------------------------------------------------------------------------

let restoring = null;

// Called once the signed-in account is known: brings back that account's saved queue (and
// carries on a batch that was running), or forgets another account's.
export function restoreUploads(userId) {
  if (!userId || state.owner === userId) return restoring ?? Promise.resolve();
  restoring = (async () => {
    if (state.owner) await clearUploads();
    set({ owner: userId });
    const meta = await saved.readMeta();
    if (state.owner !== userId) return;
    if (!meta || meta.owner !== userId) {
      if (meta) await saved.clearSaved();
      return;
    }
    const items = [];
    for (const r of await saved.readItems()) {
      if (r.status === 'done') {
        if (Date.now() - (r.updatedAt || 0) > KEEP_DONE_MS) saved.deleteItem(r.id);
        else items.push({ ...r, progress: 1 });
        continue;
      }
      const [file, cover] = await Promise.all([saved.readFile(r.id), saved.readFile(`${r.id}:cover`)]);
      // Mid-upload when the page went away: it may or may not have reached the server.
      const interrupted = ACTIVE.includes(r.status);
      items.push({
        ...r,
        file: file || null,
        cover: cover || null,
        progress: 0,
        interrupted,
        status: !file ? 'missing' : interrupted ? 'queued' : r.status,
      });
    }
    const cover = await saved.readFile(DRAFT_COVER);
    if (state.owner !== userId) return;
    items.sort((a, b) => a.addedAt - b.addedAt);
    set({
      items: [...items, ...state.items.filter((i) => !items.some((r) => r.id === i.id))],
      draft: { ...EMPTY_DRAFT, ...meta.draft },
      cover: cover || state.cover,
      restored: items.some((i) => i.status !== 'done'),
    });
    if (meta.running && state.items.some((i) => i.interrupted || (i.status === 'queued' && i.fields))) {
      if (navigator.onLine) run();
      else window.addEventListener('online', () => run(), { once: true });
    }
  })().finally(() => {
    restoring = null;
  });
  return restoring;
}

// Log out: stop everything and forget the queue on this device.
export async function clearUploads() {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  set({ owner: null, items: [], draft: EMPTY_DRAFT, cover: null, running: false, elsewhere: false, restored: false, lastBatch: null, unseen: false });
  await saved.clearSaved();
}

// --- Page lifecycle -----------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  // Leaving mid-upload restarts that file from the beginning (the rest of the queue carries on
  // when A-Read is opened again), so ask first.
  window.addEventListener('beforeunload', (event) => {
    if (state.items.some((i) => i.status === 'uploading')) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  // Uploads cut off by a lost connection start again when it's back.
  window.addEventListener('online', () => {
    if (state.running || !state.items.some((i) => i.status === 'error' && i.retryable && i.fields)) return;
    for (const item of state.items) if (item.status === 'error' && item.retryable && item.fields) patch(item.id, { status: 'queued', error: null });
    run();
  });
}
