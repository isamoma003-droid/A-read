import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Spinner } from '../components/Feedback.jsx';

// Renders a section as paragraphs of clickable sentences. The current sentence is
// highlighted through the DOM (not React state) so long chapters stay fast.
export default function TextView({
  section,
  loading,
  heading,
  sentenceIndex,
  playing,
  autoScroll,
  onSentenceClick,
  prev,
  next,
  onPrev,
  onNext,
  emptyHint,
  style,
  lockedContent,
}) {
  const root = useRef(null);

  const content = useMemo(() => {
    if (!section) return null;
    let n = 0;
    return section.paragraphs.map((paragraph, p) => (
      <p key={p}>
        {paragraph.map((sentence) => {
          const i = n++;
          return (
            <span key={i} data-s={i} className="sentence">
              {sentence}{' '}
            </span>
          );
        })}
      </p>
    ));
  }, [section]);

  // When a new section appears, jump to the saved sentence (or the top).
  useLayoutEffect(() => {
    const el = root.current?.querySelector(`[data-s="${sentenceIndex}"]`);
    if (el && sentenceIndex > 0) el.scrollIntoView({ block: 'center' });
    else root.current?.closest('.reader-main')?.scrollTo({ top: 0 });
    // Only on section change; following along is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    container.querySelector('.sentence-current')?.classList.remove('sentence-current');
    const el = container.querySelector(`[data-s="${sentenceIndex}"]`);
    if (!el) return;
    el.classList.add('sentence-current');
    if (playing && autoScroll) {
      const rect = el.getBoundingClientRect();
      const scroller = container.closest('.reader-main');
      const bounds = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      if (rect.top < bounds.top + 60 || rect.bottom > bounds.bottom - 60) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [sentenceIndex, content, playing, autoScroll]);

  const onClick = (event) => {
    const target = event.target.closest?.('[data-s]');
    if (target && !window.getSelection()?.toString()) onSentenceClick(Number(target.dataset.s));
  };

  return (
    <article className={`text-view ${playing ? 'is-playing' : ''}`} style={style}>
      <header className="text-view-header">
        <p className="eyebrow">{heading}</p>
        {section?.title && !/^Page \d+$/.test(section.title) && <h2>{section.title}</h2>}
      </header>

      {lockedContent ? (
        lockedContent
      ) : loading && !section ? (
        <div className="center-block">
          <Spinner label="Loading…" />
        </div>
      ) : section?.paragraphs.length ? (
        <div className="text-body" ref={root} onClick={onClick}>
          {content}
        </div>
      ) : (
        <p className="muted empty-section">{emptyHint}</p>
      )}

      <nav className="section-nav" aria-label="Chapter navigation">
        <button type="button" className="button button-ghost" onClick={onPrev} disabled={!prev}>
          <ChevronLeft size={18} aria-hidden="true" />
          <span className="section-nav-label">{prev ? prev.title : 'Start'}</span>
        </button>
        <button type="button" className="button button-ghost" onClick={onNext} disabled={!next}>
          <span className="section-nav-label">{next ? next.title : 'The end'}</span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </nav>
    </article>
  );
}
