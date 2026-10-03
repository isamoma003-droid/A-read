import { useState } from 'react';
import { Feather, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthors } from '../api/queries.js';
import { initials } from '../components/AuthorLinks.jsx';
import { EmptyState, ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { useDebounced } from '../utils/useDebounced.js';
import { useCanonical } from '../utils/seo.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

// /authors: everyone with a book in the library, each linking to their page.
export default function AuthorsPage() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const q = useDebounced(query.trim(), 300);
  const authors = useAuthors({ q, sort });
  const list = authors.data?.pages.flatMap((page) => page.authors) ?? [];
  const total = authors.data?.pages[0]?.total ?? 0;
  useDocumentTitle('Authors', 'Browse every author in the A-Read library and read or listen to their books.');
  useCanonical('/authors');

  return (
    <div className="narrow-wide">
      <header className="page-header">
        <h1 className="section-title">Authors</h1>
        <p className="muted">Everyone with a book in the library. Open an author to see all their books.</p>
      </header>
      <div className="filters">
        <label className="search search-compact">
          <Search size={18} aria-hidden="true" />
          <input type="search" placeholder="Search authors" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search authors" />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
          <option value="name">A–Z</option>
          <option value="books">Most books</option>
          <option value="recent">Newest books</option>
        </select>
        {authors.isSuccess && <span className="muted small">{total === 1 ? '1 author' : `${total} authors`}</span>}
      </div>
      <ErrorMessage error={authors.error} />
      {authors.isPending && <Spinner label="Loading authors…" />}
      {authors.isSuccess && list.length === 0 && (
        <EmptyState icon={Feather} title={q ? 'No authors match' : 'No authors yet'}>
          {q ? 'Try another spelling.' : 'Authors appear here as books are added.'}
        </EmptyState>
      )}
      <ul className="author-grid">
        {list.map((author) => (
          <li key={author.slug}>
            <Link to={`/authors/${encodeURIComponent(author.slug)}`} className="author-card">
              <span className="author-avatar author-avatar-small" aria-hidden="true">
                {initials(author.name)}
              </span>
              <span className="author-card-text">
                <strong>{author.name}</strong>
                <span className="muted small">{author.books === 1 ? '1 book' : `${author.books} books`}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {authors.hasNextPage && (
        <div className="center-block">
          <button type="button" className="button" onClick={() => authors.fetchNextPage()} disabled={authors.isFetchingNextPage}>
            {authors.isFetchingNextPage ? <Spinner label="Loading…" /> : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
