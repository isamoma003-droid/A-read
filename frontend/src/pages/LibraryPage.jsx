import { Library, Search, Upload, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useBooks, useContinueReading, useTags } from '../api/queries.js';
import RequiredShelf from '../components/RequiredShelf.jsx';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';
import { DownloadedList } from './DownloadsPage.jsx';
import { useOnline } from '../offline/useOnline.js';
import { useDownloads } from '../offline/store.js';
import BookCard, { BookCardSkeleton } from '../components/BookCard.jsx';
import { EmptyState, ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useDebounced } from '../utils/useDebounced.js';

const FORMATS = [
  ['', 'All formats'],
  ['pdf', 'PDF'],
  ['epub', 'EPUB'],
  ['txt', 'TXT'],
];
const AUDIO = [
  ['', 'Any'],
  ['any', 'With audio'],
  ['narration', 'Narrated'],
  ['audiobook', 'Audiobook'],
];

function ContinueReading() {
  const { data: items } = useContinueReading(true);
  if (!items?.length) return null;
  return (
    <section className="continue">
      <h2 className="section-title">Continue reading</h2>
      <div className="shelf">
        {items.map((item) => (
          <BookCard key={item.book.id} book={item.book} percent={item.percent} />
        ))}
      </div>
    </section>
  );
}

export default function LibraryPage() {
  const { user } = useAuth();
  const online = useOnline();
  const downloads = useDownloads();
  useDocumentTitle(null);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const debouncedQuery = useDebounced(query.trim(), 350);
  const filters = {
    q: debouncedQuery,
    format: params.get('format') || '',
    audio: params.get('audio') || '',
    tag: params.get('tag') || '',
    mine: params.get('mine') === 'true',
    sort: params.get('sort') || 'recent',
  };

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((params.get('q') || '') !== debouncedQuery) setParam('q', debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const books = useBooks(filters);
  const { data: tagData } = useTags();
  const list = books.data?.pages.flatMap((page) => page.books) ?? [];
  const total = books.data?.pages[0]?.total ?? 0;
  const filtering = Boolean(filters.q || filters.format || filters.audio || filters.tag || filters.mine);

  return (
    <div className="library">
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">{user ? `Hello, ${user.name.split(' ')[0]}` : 'A free library you can listen to'}</p>
          <h1>What will you read — or hear — today?</h1>
          <p className="muted">
            Every book in the shared library can be read on screen or listened to.
            {!user && (
              <>
                {' '}
                <Link to="/register">Create a free account</Link> to start.
              </>
            )}
          </p>
        </div>
        <label className="search search-hero">
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search titles, authors, tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the library"
          />
        </label>
      </section>

      {!online && (
        <section className="panel offline-panel">
          <h2 className="panel-title">Downloaded on this device</h2>
          <DownloadedList compact />
          <p className="muted small">
            These open without a connection. Other books need you to be online
            {Object.keys(downloads).length ? '.' : ': download books from their page while connected.'}
          </p>
        </section>
      )}
      {!filtering && user && <RequiredShelf />}
      {!filtering && user && <ContinueReading />}

      <section>
        <div className="library-header">
          <h2 className="section-title">Library</h2>
          {books.isSuccess && <span className="muted">{total === 1 ? '1 book' : `${total} books`}</span>}
        </div>

        <div className="filters">
          <select value={filters.format} onChange={(e) => setParam('format', e.target.value)} aria-label="Format">
            {FORMATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select value={filters.audio} onChange={(e) => setParam('audio', e.target.value)} aria-label="Audio">
            {AUDIO.map(([value, label]) => (
              <option key={value} value={value}>
                {value ? label : 'Audio: any'}
              </option>
            ))}
          </select>
          <select value={filters.sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="Sort by">
            <option value="recent">Newest first</option>
            <option value="title">Title A–Z</option>
            <option value="author">Author A–Z</option>
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={filters.mine} onChange={(e) => setParam('mine', e.target.checked ? 'true' : '')} />
            My uploads
          </label>
        </div>

        {tagData?.tags?.length > 0 && (
          <div className="tag-row">
            {tagData.tags.slice(0, 20).map(({ tag }) => (
              <button
                key={tag}
                type="button"
                className={`chip ${filters.tag === tag ? 'chip-active' : ''}`}
                onClick={() => setParam('tag', filters.tag === tag ? '' : tag)}
              >
                #{tag}
                {filters.tag === tag && <X size={12} aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}

        {books.isPending && (
          <div className="book-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <BookCardSkeleton key={i} />
            ))}
          </div>
        )}
        {online && <ErrorMessage error={books.error} />}

        {books.isSuccess && list.length === 0 && (
          filtering ? (
            <EmptyState icon={Search} title="No books match">
              Try a different search or clear the filters.
            </EmptyState>
          ) : (
            <EmptyState
              icon={Library}
              title="The library is empty"
              action={
                <Link to="/upload" className="button button-primary">
                  <Upload size={16} aria-hidden="true" /> Upload the first book
                </Link>
              }
            >
              Upload a PDF, EPUB or TXT file. Everyone with an account can read it.
            </EmptyState>
          )
        )}

        <div className="book-grid">
          {list.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>

        {books.hasNextPage && (
          <div className="center-block">
            <button type="button" className="button" onClick={() => books.fetchNextPage()} disabled={books.isFetchingNextPage}>
              {books.isFetchingNextPage ? <Spinner label="Loading…" /> : 'Load more'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
