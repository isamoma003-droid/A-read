import { useEffect, useState } from 'react';

// Downloads a stored book file. Large books are stored as several parts (to fit Cloudinary's
// per-file limit) and are joined back together here.
export async function fetchBookFile(file, signal) {
  const urls = file.parts?.length ? file.parts.map((p) => p.url) : [file.url];
  const buffers = await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      return res.arrayBuffer();
    }),
  );
  if (buffers.length === 1) return buffers[0];
  const joined = new Uint8Array(buffers.reduce((n, b) => n + b.byteLength, 0));
  let offset = 0;
  for (const buffer of buffers) {
    joined.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  return joined.buffer;
}

// For react-pdf: single files stream straight from their URL; split files are joined first.
export function usePdfSource(file) {
  const [state, setState] = useState(() => ({ key: null, source: null, error: null }));
  const key = file.parts?.length ? file.publicId : null;

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    fetchBookFile(file, controller.signal).then(
      (buffer) => setState({ key, source: { data: new Uint8Array(buffer) }, error: null }),
      (error) => error.name !== 'AbortError' && setState({ key, source: null, error }),
    );
    return () => controller.abort();
    // The file object is stable for a given key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return { source: file.url, error: null };
  return state.key === key ? state : { source: null, error: null };
}
