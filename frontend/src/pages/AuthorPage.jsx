import { useState } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, useAuthor, useBooks } from '../api/queries.js';
import { initials } from '../components/AuthorLinks.jsx';
import BookCard, { BookCardSkeleton } from '../components/BookCard.jsx';
import { ErrorMessage, PageLoader, Spinner } from '../components/Feedback.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { timeAgo } from '../utils/format.js';
import { isAdmin } from '../utils/roles.js';
import { siteUrl, useCanonical, useJsonLd } from '../utils/seo.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';
import NotFoundPage from './NotFoundPage.jsx';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// /authors/:slug: everything in the library by one author. These pages are in the sitemap, so a
// search for the author's name can bring readers here.
export default function AuthorPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { data: author, isPending, error } = useAuthor(slug);
  const [sort, setSort] = useState('recent');
  const books = useBooks({ author: slug, sort });
  const list = books.data?.pages.flatMap((page) => page.books) ?? [];
  const [editing, setEditing] = useState(false);

  const description = author
    ? `Read and listen to ${plural(author.books, 'book')} by ${author.name} on A-Read${author.bio ? `. ${author.bio}` : ', free to browse.'}`.slice(0, 160)
    : undefined;
  useDocumentTitle(author ? `${author.name}: books` : null, description);
  useCanonical(`/authors/${slug}`);
  useJsonLd(
    author && {
      '@type': 'ProfilePage',
      url: siteUrl(`/authors/${slug}`),
      mainEntity: {
        '@type': 'Person',
        name: author.name,
        url: siteUrl(`/authors/${slug}`),
        ...(author.bio ? { description: author.bio } : {}),
      },
      hasPart: list.slice(0, 50).map((book) => ({
        '@type': 'Book',
        name: book.title,
        url: siteUrl(`/books/${book.id}`),
        ...(book.cover?.url ? { image: book.cover.url } : {}),
      })),
    },
  );

  if (isPending) return <PageLoader label="Loading author…" />;
  if (error?.status === 404 || error?.status === 400) return <NotFoundPage />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div className="author-page">
      <Link to="/authors" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> All authors
      </Link>
      <header className="author-hero">
        <span className="author-avatar" aria-hidden="true">
          {initials(author.name)}
        </span>
        <div className="author-intro">
          <p className="eyebrow">Author</p>
          <h1 className="book-title">{author.name}</h1>
          <p className="muted">
            {plural(author.books, 'book')} on A-Read · newest added {timeAgo(author.latest)}
          </p>
          {author.bio && <p className="author-bio">{author.bio}</p>}
          {isAdmin(user) && !editing && (
            <button type="button" className="button button-ghost button-small" onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden="true" /> {author.bio ? 'Edit bio' : 'Write a bio'}
            </button>
          )}
          {editing && <BioEditor author={author} onDone={() => setEditing(false)} />}
        </div>
      </header>

      <section>
        <div className="library-header">
          <h2 className="section-title">Books by {author.name}</h2>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by" className="inline-select">
            <option value="recent">Newest first</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>
        <ErrorMessage error={books.error} />
        <div className="book-grid">
          {books.isPending && Array.from({ length: 4 }, (_, i) => <BookCardSkeleton key={i} />)}
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

// Admins write the short bio shown on the page (and given to search engines).
function BioEditor({ author, onDone }) {
  const queryClient = useQueryClient();
  const [bio, setBio] = useState(author.bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api(`/authors/${encodeURIComponent(author.slug)}`, { method: 'PUT', body: { bio } });
      queryClient.setQueryData(keys.author(author.slug), result.author);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form stack-sm" onSubmit={save}>
      <label className="field">
        <span>About {author.name}</span>
        <textarea rows={5} maxLength={3000} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Who they are, where they're from, what they write about." />
      </label>
      <ErrorMessage error={error} />
      <div className="button-row">
        <button className="button button-primary button-small" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="button button-ghost button-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
