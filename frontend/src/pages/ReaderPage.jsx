import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, List, Settings } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { keys, sectionQuery, useBook, useProgress, useSection, useSections } from '../api/queries.js';
import { ErrorMessage, PageLoader, Spinner } from '../components/Feedback.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import AudioBar from '../reader/AudioBar.jsx';
import LockedSection from '../reader/LockedSection.jsx';
import ReaderSidebar from '../reader/ReaderSidebar.jsx';
import TextView from '../reader/TextView.jsx';
import { useAudiobookPlayer, useNarrationPlayer } from '../reader/useAudio.js';
import { pickVoice, useBrowserVoices, useSpeechPlayer } from '../reader/useSpeech.js';
import { partName } from '../utils/format.js';
import { useLatest } from '../utils/useLatest.js';
import { saveProgress } from '../offline/progressQueue.js';
import { keepBookOffline } from '../offline/store.js';
import { useOnline } from '../offline/useOnline.js';

// Page views are only needed for PDF/EPUB, so their libraries load on demand.
const PdfView = lazy(() => import('../reader/PdfView.jsx'));
const EpubView = lazy(() => import('../reader/EpubView.jsx'));

const FONTS = { serif: '"Literata", Georgia, serif', sans: '"Inter", system-ui, sans-serif' };

export default function ReaderPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const book = useBook(id);
  const sections = useSections(id);
  const progress = useProgress(id);

  if (book.isPending || sections.isPending || progress.isPending) return <PageLoader label="Opening book…" />;
  const error = book.error || sections.error || progress.error;
  if (error) {
    return (
      <div className="page narrow">
        <ErrorMessage error={error} />
        <Link to="/">Back to the library</Link>
      </div>
    );
  }

  const requested = search.get('section');
  return (
    <Reader
      key={id}
      book={book.data}
      sections={sections.data}
      saved={progress.data}
      requestedSection={requested !== null && /^\d+$/.test(requested) ? Number(requested) : null}
      listen={search.get('listen')}
    />
  );
}

function Reader({ book, sections, saved, requestedSection, listen }) {
  const queryClient = useQueryClient();
  const { settings, update, theme } = useSettings();
  const hasText = book.wordCount > 0;
  // A premium book's original file comes only once it's unlocked (it holds every chapter).
  const hasPageView = book.format !== 'txt' && Boolean(book.file);
  const pageViewLocked = book.format !== 'txt' && !book.file && Boolean(book.premium);
  const narrationReady = ['ready', 'partial'].includes(book.narration?.status);
  const lastSection = Math.max(0, sections.length - 1);
  const clampSection = useCallback((i) => Math.min(Math.max(0, i || 0), lastSection), [lastSection]);

  // --- Position & view --------------------------------------------------------------------
  const [position, setPosition] = useState(() => {
    if (requestedSection !== null) return { section: clampSection(requestedSection), sentence: 0 };
    if (saved) return { section: clampSection(saved.sectionIndex), sentence: saved.sentenceIndex || 0 };
    const firstWithText = sections.findIndex((s) => s.sentenceCount > 0);
    return { section: Math.max(0, firstWithText), sentence: 0 };
  });
  const positionRef = useLatest(position);

  const [chosenView, setView] = useState(() => (!hasPageView ? 'text' : !hasText ? 'page' : saved?.view || 'text'));
  // The page view comes and goes with the original file (a book made premium, or unlocked, while
  // it's open), and a book without text only has the page view.
  const view = chosenView === 'page' && !hasPageView ? 'text' : !hasText && hasPageView ? 'page' : chosenView;
  // Last EPUB page-view location and the section it belongs to.
  const [epubLoc, setEpubLoc] = useState(() => ({ cfi: saved?.epubCfi, section: saved?.sectionIndex }));
  const epubCfi = epubLoc.cfi;
  const [panel, setPanel] = useState(null);

  const sectionMeta = sections[position.section];
  const {
    data: section,
    isFetching: sectionLoading,
    error: sectionError,
  } = useSection(book.id, position.section, { locked: Boolean(sectionMeta?.locked) });
  // 402: locked since the chapter list was loaded (an admin changed the premium chapters).
  const sectionLocked = Boolean(sectionMeta?.locked) || sectionError?.status === 402;
  const lockPrice = book.premium?.price ?? sectionError?.details?.price;

  // Locked since this page loaded: fetch the book and its chapter list again to show its premium state.
  useEffect(() => {
    if (sectionError?.status !== 402 || sectionMeta?.locked) return;
    queryClient.invalidateQueries({ queryKey: keys.book(book.id) });
    queryClient.invalidateQueries({ queryKey: keys.sections(book.id) });
  }, [sectionError, sectionMeta?.locked, book.id, queryClient]);
  const sentences = useMemo(() => section?.paragraphs.flat() ?? [], [section]);

  useEffect(() => {
    const next = position.section + 1;
    if (next <= lastSection && !sections[next].locked) queryClient.prefetchQuery(sectionQuery(book.id, next));
  }, [book.id, position.section, lastSection, sections, queryClient]);

  // --- Audio --------------------------------------------------------------------------------
  const modes = useMemo(
    () => [hasText && 'device', narrationReady && 'narration', book.audiobook?.url && 'audiobook'].filter(Boolean),
    [hasText, narrationReady, book.audiobook?.url],
  );
  const [mode, setMode] = useState(() => {
    if (listen === 'audiobook' && book.audiobook?.url) return 'audiobook';
    if (narrationReady) return 'narration';
    if (hasText) return 'device';
    return book.audiobook?.url ? 'audiobook' : 'device';
  });

  // Whether a section can be played in the current mode.
  const playable = useCallback(
    (index) => {
      const meta = sections[index];
      if (!meta || meta.locked) return false;
      return mode === 'narration' ? meta.narrationDuration != null : meta.sentenceCount > 0;
    },
    [sections, mode],
  );
  const nextPlayable = useCallback(
    (from) => {
      for (let i = from + 1; i < sections.length; i++) if (playable(i)) return i;
      return -1;
    },
    [sections.length, playable],
  );

  // Set when playback should start as soon as the current section's text has loaded.
  const [listenOnOpen] = useState(() => Boolean(listen) && mode !== 'audiobook');
  const autoPlay = useRef(listenOnOpen);
  const [waiting, setWaiting] = useState(listenOnOpen);

  const advanceSection = useCallback(() => {
    const next = nextPlayable(positionRef.current.section);
    if (next < 0) {
      autoPlay.current = false;
      setWaiting(false);
      return;
    }
    autoPlay.current = true;
    setWaiting(true);
    setPosition({ section: next, sentence: 0 });
  }, [nextPlayable, positionRef]);

  const onSentence = useCallback((i) => setPosition((p) => (p.sentence === i ? p : { ...p, sentence: i })), []);

  const browserVoices = useBrowserVoices();
  const online = useOnline();
  const voice = useMemo(
    () => pickVoice(browserVoices, settings.voiceURI, book.language, { offline: !online }),
    [browserVoices, settings.voiceURI, book.language, online],
  );
  const speech = useSpeechPlayer({ sentences, rate: settings.rate, voice, onSentence, onEnd: advanceSection });
  const narration = useNarrationPlayer({ narration: section?.narration, rate: settings.rate, onSentence, onEnd: advanceSection });
  const audiobook = useAudiobookPlayer({ url: book.audiobook?.url, initialTime: saved?.audiobookTime || 0, rate: settings.rate });

  const playing = mode === 'device' ? speech.playing : mode === 'narration' ? narration.playing : audiobook.playing;
  const { playFrom: speechPlayFrom, stop: speechStop } = speech;
  const { playFrom: narrationPlayFrom, stop: narrationStop } = narration;
  const { play: audiobookPlay, stop: audiobookStop } = audiobook;

  const startAt = useCallback(
    (sentence) => {
      if (mode === 'device') speechPlayFrom(sentence);
      else if (mode === 'narration') narrationPlayFrom(sentence);
    },
    [mode, speechPlayFrom, narrationPlayFrom],
  );

  const stopAll = useCallback(() => {
    autoPlay.current = false;
    setWaiting(false);
    speechStop();
    narrationStop();
    audiobookStop();
  }, [speechStop, narrationStop, audiobookStop]);

  // Start (or continue) playback once the section we moved to has loaded.
  useEffect(() => {
    if (autoPlay.current && sectionLocked) {
      // Jumped to a locked chapter while listening: stop on its unlock screen.
      autoPlay.current = false;
      setWaiting(false);
      return;
    }
    if (!autoPlay.current || !section) return;
    autoPlay.current = false;
    setWaiting(false);
    if (!playable(positionRef.current.section)) {
      advanceSection();
      return;
    }
    startAt(positionRef.current.sentence);
  }, [section, sectionLocked, playable, advanceSection, startAt, positionRef]);

  useEffect(() => {
    if (listen === 'audiobook' && mode === 'audiobook') audiobookPlay();
    // Only when the reader opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    if (playing || waiting) {
      stopAll();
      return;
    }
    if (mode === 'audiobook') {
      audiobookPlay();
      return;
    }
    // A locked chapter has nothing to read aloud (its unlock box is on screen).
    if (sectionLocked) return;
    const current = positionRef.current;
    if (!playable(current.section)) {
      advanceSection();
      return;
    }
    if (!section) {
      autoPlay.current = true;
      setWaiting(true);
      return;
    }
    startAt(current.sentence);
  }, [playing, waiting, mode, sectionLocked, playable, section, stopAll, audiobookPlay, advanceSection, startAt, positionRef]);

  // Moves the reading position; keeps audio going if it was playing.
  const jump = useCallback(
    ({ sectionIndex, sentenceIndex = 0, audiobookTime }) => {
      const target = clampSection(sectionIndex);
      if (mode === 'audiobook') {
        if (audiobookTime != null) audiobook.seek(audiobookTime);
        setPosition({ section: target, sentence: sentenceIndex });
        return;
      }
      const keepPlaying = playing || waiting;
      if (target === positionRef.current.section) {
        setPosition({ section: target, sentence: sentenceIndex });
        if (keepPlaying && section) startAt(sentenceIndex);
        return;
      }
      if (keepPlaying) {
        speechStop();
        narrationStop();
        autoPlay.current = true;
        setWaiting(true);
      }
      setPosition({ section: target, sentence: sentenceIndex });
    },
    [clampSection, mode, audiobook, playing, waiting, section, startAt, speechStop, narrationStop, positionRef],
  );

  const changeMode = (next) => {
    stopAll();
    setMode(next);
  };

  const step = (delta) => {
    if (mode === 'audiobook') {
      audiobook.skip(delta * 30);
      return;
    }
    const { section: s, sentence } = positionRef.current;
    const target = sentence + delta;
    if (target < 0) {
      if (s > 0) jump({ sectionIndex: s - 1, sentenceIndex: 0 });
    } else if (target >= sentences.length) {
      if (s < lastSection) jump({ sectionIndex: s + 1, sentenceIndex: 0 });
    } else {
      jump({ sectionIndex: s, sentenceIndex: target });
    }
  };

  // Opening a book keeps it available offline inside the app; playing its audiobook adds that too.
  useEffect(() => {
    keepBookOffline(book);
  }, [book]);
  useEffect(() => {
    if (mode === 'audiobook' && audiobook.playing) keepBookOffline(book, { audiobook: true });
  }, [book, mode, audiobook.playing]);

  // --- Progress -----------------------------------------------------------------------------
  const percent = useMemo(() => {
    if (!hasText && audiobook.duration) return (audiobook.time / audiobook.duration) * 100;
    const total = sections.reduce((n, s) => n + s.wordCount, 0);
    if (!total) return sections.length ? ((position.section + 1) / sections.length) * 100 : 0;
    const before = sections.slice(0, position.section).reduce((n, s) => n + s.wordCount, 0);
    const meta = sections[position.section];
    // Counting the current sentence as read means the last sentence of the book is 100% (finished).
    const within = meta?.sentenceCount ? (position.sentence + 1) / meta.sentenceCount : 0;
    return Math.min(100, ((before + within * (meta?.wordCount || 0)) / total) * 100);
  }, [hasText, audiobook.time, audiobook.duration, sections, position]);

  const pending = useRef(null);
  const timer = useRef(null);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const body = pending.current;
    if (!body) return;
    pending.current = null;
    queryClient.setQueryData(keys.progress(book.id), (old) => ({ ...(old || {}), ...body }));
    saveProgress(book.id, body, { keepalive: true });
  }, [book.id, queryClient]);

  const audiobookBucket = Math.floor(audiobook.time / 5);
  useEffect(() => {
    pending.current = {
      sectionIndex: position.section,
      sentenceIndex: position.sentence,
      view,
      epubCfi,
      audiobookTime: Math.floor(audiobook.time),
      percent: Math.round(percent * 10) / 10,
    };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1500);
    // audiobook.time is sampled through audiobookBucket to save at most every 5 s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, view, epubCfi, audiobookBucket, percent, flush]);

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
      queryClient.invalidateQueries({ queryKey: keys.continueReading });
      queryClient.invalidateQueries({ queryKey: keys.myAssignments });
      queryClient.invalidateQueries({ queryKey: keys.book(book.id) });
      queryClient.invalidateQueries({ queryKey: ['books'] });
    };
  }, [flush, queryClient, book.id]);

  // --- Keyboard & lock-screen controls --------------------------------------------------------
  const controls = useLatest({ toggle, step, stopAll, playing, jump, view });

  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.('input, textarea, select, button, a, [contenteditable]')) return;
      if (event.key === ' ') {
        event.preventDefault();
        controls.current.toggle();
      } else if (book.format === 'pdf' && controls.current.view === 'page' && /^Arrow(Left|Right)$/.test(event.key)) {
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        controls.current.jump({ sectionIndex: positionRef.current.section + delta });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [book.format, controls, positionRef]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({
      title: book.title,
      artist: book.author || '',
      album: 'A-Read',
      artwork: book.cover?.url ? [{ src: book.cover.url, sizes: '512x512' }] : [],
    });
    const handlers = {
      play: () => !controls.current.playing && controls.current.toggle(),
      pause: () => controls.current.stopAll(),
      previoustrack: () => controls.current.step(-1),
      nexttrack: () => controls.current.step(1),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Unsupported action in this browser.
      }
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
    };
  }, [book.title, book.author, book.cover?.url, controls]);

  // --- Rendering -----------------------------------------------------------------------------
  const makeBookmark = () => ({
    sectionIndex: position.section,
    sentenceIndex: position.sentence,
    epubCfi: view === 'page' && book.format === 'epub' ? epubCfi : undefined,
    audiobookTime: mode === 'audiobook' ? Math.floor(audiobook.time) : undefined,
    label: sectionMeta?.title || '',
    snippet: (sentences[position.sentence] || '').slice(0, 280),
  });

  const onEpubRelocated = useCallback(
    ({ href, cfi }) => {
      const index = sections.findIndex((s) => s.href && (s.href === href.split('#')[0] || href.endsWith(s.href)));
      setEpubLoc({ cfi, section: index >= 0 ? index : positionRef.current.section });
      if (index >= 0 && index !== positionRef.current.section) controls.current.jump({ sectionIndex: index });
    },
    [sections, controls, positionRef],
  );

  const spoken = (playing || waiting) && mode !== 'audiobook' ? sentences[position.sentence] : null;
  const caption = spoken ? (
    <div className="now-reading" aria-live="off">
      <span className="eyebrow">Now reading</span>
      {spoken}
    </div>
  ) : null;

  let disabledReason = null;
  if (mode === 'device' && !speech.supported) disabledReason = "This browser can't read aloud. Try Chrome, Edge or Safari.";
  if (mode === 'device' && !hasText) disabledReason = 'No text to read aloud.';
  if (sectionLocked && mode !== 'audiobook') disabledReason = `This ${partName(book.format)} is locked. Unlock the book to listen.`;

  const status = sectionLocked && mode !== 'audiobook'
    ? `${sectionMeta?.title || ''} · locked`
    : mode === 'narration' && !playable(position.section) && sectionMeta
      ? 'This part has no narration. Press play to skip ahead.'
      : sentences.length
        ? `${sectionMeta?.title || ''} · sentence ${Math.min(position.sentence + 1, sentences.length)} of ${sentences.length}${
            mode === 'device' && voice ? ` · ${voice.name}` : ''
          }`
        : sectionMeta?.title || '';

  const togglePanel = (name) => setPanel((current) => (current === name ? null : name));
  const textStyle = { fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight, fontFamily: FONTS[settings.fontFamily] };

  return (
    <div className="reader">
      <header className="reader-top">
        <Link to={`/books/${book.id}`} className="icon-button" title="Back to book details">
          <ArrowLeft size={20} />
          <span className="sr-only">Back to book details</span>
        </Link>
        <div className="reader-title">
          <strong>{book.title}</strong>
          <span className="muted">
            {sectionMeta?.title} · {Math.round(percent)}%
          </span>
        </div>
        {(hasPageView || pageViewLocked) && hasText && (
          <div className="segmented segmented-small" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === 'text'} className={view === 'text' ? 'active' : ''} onClick={() => setView('text')}>
              Text
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'page'}
              className={view === 'page' ? 'active' : ''}
              onClick={() => setView('page')}
              disabled={!hasPageView}
              title={hasPageView ? undefined : 'Page view opens once you unlock this book'}
            >
              Page
            </button>
          </div>
        )}
        <div className="reader-actions">
          <button type="button" className={`icon-button ${panel === 'contents' ? 'active' : ''}`} onClick={() => togglePanel('contents')} title="Contents">
            <List size={20} />
            <span className="sr-only">Contents</span>
          </button>
          <button type="button" className={`icon-button ${panel === 'bookmarks' ? 'active' : ''}`} onClick={() => togglePanel('bookmarks')} title="Bookmarks">
            <Bookmark size={20} />
            <span className="sr-only">Bookmarks</span>
          </button>
          <button type="button" className={`icon-button ${panel === 'settings' ? 'active' : ''}`} onClick={() => togglePanel('settings')} title="Reading settings">
            <Settings size={20} />
            <span className="sr-only">Reading settings</span>
          </button>
        </div>
      </header>

      <div className="reader-body">
        <main className="reader-main">
          {view === 'text' && (
            <TextView
              section={section}
              loading={sectionLoading}
              heading={book.format === 'pdf' ? `Page ${position.section + 1} of ${sections.length}` : `${position.section + 1} / ${sections.length}`}
              sentenceIndex={position.sentence}
              playing={playing || waiting}
              autoScroll={settings.autoScroll}
              onSentenceClick={(i) => jump({ sectionIndex: position.section, sentenceIndex: i })}
              prev={sections[position.section - 1]}
              next={sections[position.section + 1]}
              onPrev={() => jump({ sectionIndex: position.section - 1 })}
              onNext={() => jump({ sectionIndex: position.section + 1 })}
              emptyHint={book.format === 'pdf' ? 'This page has no text (it may be an image). Switch to Page view to see it.' : 'This part has no text.'}
              style={textStyle}
              lockedContent={sectionLocked ? <LockedSection book={book} sections={sections} price={lockPrice} /> : null}
            />
          )}
          <Suspense
            fallback={
              <div className="center-block">
                <Spinner label="Loading viewer…" />
              </div>
            }
          >
          {view === 'page' && hasPageView && book.format === 'pdf' && (
            <PdfView
              file={book.file}
              pageNumber={position.section + 1}
              pageCount={sections.length}
              onPageChange={(page) => jump({ sectionIndex: page - 1 })}
              zoom={settings.pdfZoom}
              onZoom={(pdfZoom) => update({ pdfZoom })}
              caption={caption}
            />
          )}
          {view === 'page' && hasPageView && book.format === 'epub' && (
            <EpubView
              key={book.file.publicId}
              file={book.file}
              href={sectionMeta?.href}
              initialCfi={epubLoc.section === position.section ? epubLoc.cfi : undefined}
              theme={theme}
              fontSize={settings.fontSize}
              fontFamily={settings.fontFamily}
              onRelocated={onEpubRelocated}
              caption={caption}
            />
          )}
          </Suspense>
        </main>

        {panel && (
          <ReaderSidebar
            panel={panel}
            onClose={() => setPanel(null)}
            book={book}
            sections={sections}
            currentSection={position.section}
            onJump={(target) => {
              jump(target);
              if (window.matchMedia('(max-width: 800px)').matches) setPanel(null);
            }}
            makeBookmark={makeBookmark}
          />
        )}
      </div>

      {modes.length > 0 && (
        <AudioBar
          modes={modes}
          mode={mode}
          onModeChange={changeMode}
          playing={playing}
          waiting={waiting}
          onToggle={toggle}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          rate={settings.rate}
          onRate={(rate) => update({ rate })}
          status={status}
          error={mode === 'device' ? speech.error : mode === 'narration' ? narration.error : audiobook.error}
          audiobook={mode === 'audiobook' ? audiobook : null}
          disabledReason={disabledReason}
        />
      )}
    </div>
  );
}
