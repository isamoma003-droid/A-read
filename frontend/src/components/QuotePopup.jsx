import { useEffect, useState } from 'react';
import { BookOpen, Quote as QuoteIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useSystemConfig } from '../api/queries.js';
import CenteredDialog from './CenteredDialog.jsx';
import { usePopupTurn } from './popupQueue.js';

// The quotes this device has seen in the current round, and the book the last one came from.
// The server picks a quote that isn't in the list and isn't from that book.
const SEEN_KEY = 'a-read-quotes-seen';
const LAST_BOOK_KEY = 'a-read-quotes-last-book';
const SESSION_KEY = 'a-read-quote-shown';
const DELAY_MS = 1200;

// Even reaching localStorage can throw (blocked site data), so every access is guarded.
const store = (kind) => {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

function read(kind, key, fallback) {
  try {
    return JSON.parse(store(kind)?.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function write(kind, key, value) {
  try {
    store(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: quotes may repeat on this device.
  }
}

// One book quote each time the app is opened (once per browser session), in the centre.
export default function QuotePopup() {
  const { data: config } = useSystemConfig();
  const [next, setNext] = useState(null);
  const [closed, setClosed] = useState(false);
  const enabled = Boolean(config?.quotesEnabled);

  useEffect(() => {
    if (!enabled || read('session', SESSION_KEY, false)) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      api('/quotes/next', { method: 'POST', body: { seen: read('local', SEEN_KEY, []), lastBook: read('local', LAST_BOOK_KEY, null) } })
        .then((result) => !cancelled && result.quote && setNext(result))
        .catch(() => {});
    }, DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled]);

  const visible = usePopupTurn('quote', Boolean(next) && !closed) && Boolean(next) && !closed;

  // Remembered once it's actually on screen, so it never comes up again this round.
  useEffect(() => {
    if (!visible) return;
    // A new round keeps only what the server says still counts as seen.
    const seen = next.reset ? (next.keep ?? []) : read('local', SEEN_KEY, []);
    write('local', SEEN_KEY, [...seen.filter((id) => id !== next.quote.id), next.quote.id].slice(-5000));
    write('local', LAST_BOOK_KEY, next.quote.bookKey);
    write('session', SESSION_KEY, true);
  }, [visible, next]);

  if (!visible) return null;
  const { quote } = next;
  const close = () => setClosed(true);
  return (
    <CenteredDialog open onClose={close} labelledBy="quote-popup-text" className="quote-popup">
      <span className="quote-mark" aria-hidden="true">
        <QuoteIcon size={22} />
      </span>
      <blockquote className="quote-text" id="quote-popup-text">
        {quote.text}
      </blockquote>
      <p className="quote-source">
        <cite>{quote.bookTitle}</cite>
        {quote.author && <span> · {quote.author}</span>}
      </p>
      <div className="button-row quote-actions">
        {quote.book && (
          <Link to={`/books/${quote.book.id}`} className="button button-primary" onClick={close}>
            <BookOpen size={16} aria-hidden="true" /> Read this book
          </Link>
        )}
        <button type="button" className={`button ${quote.book ? 'button-ghost' : 'button-primary'}`} onClick={close}>
          Close
        </button>
      </div>
    </CenteredDialog>
  );
}
