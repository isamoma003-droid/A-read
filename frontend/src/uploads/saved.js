// The upload queue is kept in IndexedDB, files included, so a reload or a closed tab doesn't lose
// it. Book files are written once into their own store (they can be 100 MB); the small records
// that describe each upload are rewritten as it moves along. Everything here can fail (private
// mode, a full disk): uploads then still work for as long as the tab stays open.
const DB_NAME = 'a-read-uploads';
const ITEMS = 'items';
const FILES = 'files';
const META = 'meta';

let opening = null;
function db() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'));
  opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ITEMS, { keyPath: 'id' });
      request.result.createObjectStore(FILES);
      request.result.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB is blocked'));
  }).catch((err) => {
    opening = null;
    throw err;
  });
  return opening;
}

// Runs `fn(store)` in one transaction and resolves with its request's result once committed.
function transact(name, mode, fn) {
  return db().then(
    (database) =>
      new Promise((resolve, reject) => {
        const tx = database.transaction(name, mode);
        const request = fn(tx.objectStore(name));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const readItems = () => transact(ITEMS, 'readonly', (store) => store.getAll()).catch(() => []);
export const writeItem = (record) => transact(ITEMS, 'readwrite', (store) => store.put(record)).catch(() => {});
export const deleteItem = (id) =>
  Promise.all([
    transact(ITEMS, 'readwrite', (store) => store.delete(id)),
    transact(FILES, 'readwrite', (store) => store.delete(IDBKeyRange.bound(id, `${id}￿`))),
  ]).catch(() => {});

// Resolves to false when the file couldn't be kept (usually the browser's storage quota).
export const writeFile = (key, file) =>
  file
    ? transact(FILES, 'readwrite', (store) => store.put(file, key)).then(
        () => true,
        () => false,
      )
    : transact(FILES, 'readwrite', (store) => store.delete(key)).then(
        () => true,
        () => false,
      );
export const readFile = (key) => transact(FILES, 'readonly', (store) => store.get(key)).catch(() => null);
export const deleteFiles = (id) => transact(FILES, 'readwrite', (store) => store.delete(IDBKeyRange.bound(id, `${id}￿`))).catch(() => {});

export const readMeta = () => transact(META, 'readonly', (store) => store.get('queue')).catch(() => null);
export const writeMeta = (value) => transact(META, 'readwrite', (store) => store.put(value, 'queue')).catch(() => {});

export const clearSaved = () =>
  Promise.all([ITEMS, FILES, META].map((name) => transact(name, 'readwrite', (store) => store.clear()))).catch(() => {});
