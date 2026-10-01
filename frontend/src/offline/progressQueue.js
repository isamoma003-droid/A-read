import { api } from '../api/client.js';
import { updateOfflineProgress } from './store.js';

// Progress saved while offline waits here (latest per book) and is sent when the connection returns.
const KEY = 'a-read-pending-progress';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function write(pending) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // ignore
  }
}

export async function saveProgress(bookId, body, { keepalive } = {}) {
  updateOfflineProgress(bookId, body).catch(() => {});
  try {
    await api(`/progress/${bookId}`, { method: 'PUT', body, keepalive });
  } catch (err) {
    if (err.status) return; // the server answered (e.g. book deleted): don't retry
    write({ ...read(), [bookId]: body });
  }
}

let flushing = false;
export async function flushPendingProgress() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const [bookId, body] of Object.entries(read())) {
      try {
        await api(`/progress/${bookId}`, { method: 'PUT', body });
        const { [bookId]: _sent, ...rest } = read();
        write(rest);
      } catch (err) {
        if (err.status) {
          const { [bookId]: _dropped, ...rest } = read();
          write(rest);
        } else {
          break; // still offline
        }
      }
    }
  } finally {
    flushing = false;
  }
}
