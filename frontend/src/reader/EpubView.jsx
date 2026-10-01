import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ePub from 'epubjs';
import { useLatest } from '../utils/useLatest.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';

const THEMES = {
  light: { body: { color: '#1f1d1a', background: '#fffdf9' } },
  sepia: { body: { color: '#3b2f22', background: '#f4ecd8' } },
  dark: { body: { color: '#e7e3dc', background: '#1b1c1e' }, a: { color: '#9ccfbf' } },
};
const FONTS = { serif: '"Literata", Georgia, serif', sans: '"Inter", system-ui, sans-serif' };

const samePath = (a, b) => Boolean(a && b) && (a.split('#')[0] === b.split('#')[0] || a.endsWith(`/${b}`) || b.endsWith(`/${a}`));

// Paginated EPUB rendering with epub.js (mount with key={url}). Reports the current spine href/CFI and follows `href`
// when the reader moves to another chapter (TOC, audio).
export default function EpubView({ url, href, initialCfi, theme, fontSize, fontFamily, onRelocated, caption }) {
  const viewer = useRef(null);
  const rendition = useRef(null);
  const shownHref = useRef(null);
  const latest = useLatest({ onRelocated, href, initialCfi });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let book;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const data = await res.arrayBuffer();
        if (cancelled) return;
        book = ePub(data);
        const r = book.renderTo(viewer.current, { width: '100%', height: '100%', spread: 'none', flow: 'paginated' });
        rendition.current = r;
        Object.entries(THEMES).forEach(([name, styles]) => r.themes.register(name, styles));
        r.on('relocated', (location) => {
          shownHref.current = location.start.href;
          latest.current.onRelocated?.({ href: location.start.href, cfi: location.start.cfi });
        });
        r.on('keyup', (event) => {
          if (event.key === 'ArrowLeft') r.prev();
          if (event.key === 'ArrowRight') r.next();
        });
        const start = latest.current.initialCfi || latest.current.href;
        await r.display(start || undefined).catch(() => r.display());
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
      rendition.current = null;
      book?.destroy();
    };
  }, [url, latest]);

  useEffect(() => {
    if (ready && href && !samePath(shownHref.current, href)) rendition.current?.display(href);
  }, [href, ready]);

  useEffect(() => {
    const r = rendition.current;
    if (!ready || !r) return;
    r.themes.select(theme);
    r.themes.fontSize(`${fontSize}px`);
    r.themes.font(FONTS[fontFamily] || FONTS.serif);
  }, [ready, theme, fontSize, fontFamily]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.('input, textarea, select')) return;
      if (event.key === 'ArrowLeft') rendition.current?.prev();
      if (event.key === 'ArrowRight') rendition.current?.next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="epub-view">
      {error && <ErrorMessage>Could not open this EPUB: {error.message}</ErrorMessage>}
      {!ready && !error && (
        <div className="center-block">
          <Spinner label="Opening book…" />
        </div>
      )}
      <div className="epub-stage">
        <button type="button" className="page-turn" onClick={() => rendition.current?.prev()} title="Previous page">
          <ChevronLeft size={22} />
          <span className="sr-only">Previous page</span>
        </button>
        <div ref={viewer} className="epub-viewer" />
        <button type="button" className="page-turn" onClick={() => rendition.current?.next()} title="Next page">
          <ChevronRight size={22} />
          <span className="sr-only">Next page</span>
        </button>
      </div>
      {caption}
    </div>
  );
}
