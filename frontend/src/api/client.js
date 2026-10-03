export const API_URL = new URL((import.meta.env.VITE_API_URL || '/api').replace(/\/$/, ''), window.location.origin).href;
const TOKEN_KEY = 'a-read-token';


export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token) => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage unavailable (private mode): the session lasts until the tab closes.
    }
  },
};

let unauthorizedHandler = () => {};
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

export function authHeaders() {
  const token = tokenStore.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function parseResponse(status, text) {
  const data = parseJson(text);
  if (status >= 200 && status < 300) return data;
  if (status === 401) unauthorizedHandler();
  const message = data?.error || (status === 413 ? 'That file is too large' : `Request failed (${status})`);
  throw new ApiError(status, message, data?.details);
}

export async function api(path, { method = 'GET', body, signal, keepalive } = {}) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      keepalive,
      headers: { ...authHeaders(), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server. Check your connection and that the API is running.');
  }
  return parseResponse(res.status, await res.text());
}

// Multipart upload with progress (fetch can't report upload progress). `signal` cancels it.
export function upload(path, formData, { method = 'POST', onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_URL}${path}`);
    for (const [key, value] of Object.entries(authHeaders())) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => parseResponse(xhr.status, xhr.responseText).then(resolve, reject);
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
}
