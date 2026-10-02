import { useState } from 'react';
import { BookOpen, Pencil, Plus, Quote as QuoteIcon, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, useAdminQuotes, useBooks, useSystemConfig } from '../api/queries.js';
import BookCover from '../components/BookCover.jsx';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { useDebounced } from '../utils/useDebounced.js';

// Admins keep the quotes shown in the popup when the app opens. Each visitor sees every quote
// once before any repeats, and never two from the same book in a row.
export default function AdminQuotes() {
  const queryClient = useQueryClient();
  const { data: quotes, isPending, error } = useAdminQuotes();
  const { data: system } = useSystemConfig();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.adminQuotes });
  const books = new Set((quotes || []).filter((q) => q.enabled).map((q) => q.bookKey)).size;

  const run = async (request) => {
    setActionError(null);
    setNotice(null);
    try {
      const result = await request();
      await refresh();
      return result;
    } catch (err) {
      setActionError(err);
      return null;
    }
  };

  const toggle = (q) => run(() => api(`/quotes/${q.id}`, { method: 'PATCH', body: { enabled: !q.enabled } }));
  const remove = (q) => window.confirm('Delete this quote?') && run(() => api(`/quotes/${q.id}`, { method: 'DELETE' }));
  const addClassics = async () => {
    const result = await run(() => api('/quotes/classics', { method: 'POST' }));
    if (result) setNotice(result.added ? `Added ${result.added} classic quote${result.added === 1 ? '' : 's'}.` : 'All the classic quotes are already in the list.');
  };

  return (
    <div className="stack">
      {system && !system.quotesEnabled && <p className="notice">The quote popup is switched off. A super admin can turn it on in Admin → System.</p>}
      {adding ? (
        <QuoteForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : (
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> Add a quote
          </button>
          <button type="button" className="button" onClick={addClassics}>
            <Sparkles size={16} aria-hidden="true" /> Add the classic quotes
          </button>
        </div>
      )}

      <section className="panel">
        <h2 className="panel-title">
          <QuoteIcon size={18} aria-hidden="true" /> Book quotes
        </h2>
        <p className="muted small">
          One quote pops up in the middle of the screen each time someone opens the app. Every visitor sees each quote once before
          any comes back, and never two from the same book in a row
          {quotes ? ` (${quotes.filter((q) => q.enabled).length} showing, from ${books} book${books === 1 ? '' : 's'})` : ''}.
        </p>
        {notice && <p className="notice">{notice}</p>}
        <ErrorMessage error={error || actionError} />
        {isPending && <Spinner label="Loading…" />}
        {quotes?.length === 0 && <p className="muted">No quotes yet. Add your own, or start with the classic quotes.</p>}
        <ul className="quote-admin-list">
          {quotes?.map((q) =>
            editing === q.id ? (
              <li key={q.id}>
                <QuoteForm
                  quote={q}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    refresh();
                  }}
                />
              </li>
            ) : (
              <li key={q.id} className={q.enabled ? '' : 'is-off'}>
                <blockquote>{q.text}</blockquote>
                <div className="quote-admin-meta">
                  <span>
                    <cite>{q.bookTitle}</cite>
                    {q.author && <span className="muted"> · {q.author}</span>}
                    {q.book && (
                      <Link to={`/books/${q.book.id}`} className="badge badge-accent">
                        <BookOpen size={11} aria-hidden="true" /> In the library
                      </Link>
                    )}
                  </span>
                  <span className="actions">
                    <label className="checkbox small">
                      <input type="checkbox" checked={q.enabled} onChange={() => toggle(q)} /> Showing
                    </label>
                    <button type="button" className="icon-button" onClick={() => setEditing(q.id)} title="Edit">
                      <Pencil size={16} />
                      <span className="sr-only">Edit quote</span>
                    </button>
                    <button type="button" className="icon-button danger" onClick={() => remove(q)} title="Delete">
                      <Trash2 size={16} />
                      <span className="sr-only">Delete quote</span>
                    </button>
                  </span>
                </div>
              </li>
            ),
          )}
        </ul>
      </section>
    </div>
  );
}

function QuoteForm({ quote, onSaved, onCancel }) {
  const [book, setBook] = useState(quote?.book ?? null);
  const [title, setTitle] = useState(quote?.bookTitle ?? '');
  const [author, setAuthor] = useState(quote?.author ?? '');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget.elements;
    const body = { text: form.text.value, bookTitle: title, author, bookId: book?.id ?? null };
    setBusy(true);
    setError(null);
    try {
      await api(quote ? `/quotes/${quote.id}` : '/quotes', { method: quote ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel form" onSubmit={onSubmit}>
      <h2 className="panel-title">{quote ? 'Edit quote' : 'New quote'}</h2>
      <label className="field">
        <span>Quote</span>
        <textarea name="text" rows={3} required maxLength={1000} defaultValue={quote?.text} placeholder="A line worth remembering…" />
      </label>
      <div className="field">
        <span>Book in this library (optional)</span>
        {book ? (
          <div className="picked-book">
            <BookCover book={book} size="tiny" />
            <div>
              <strong>{book.title}</strong>
              <div className="muted small">Readers get a “Read this book” button</div>
            </div>
            <button type="button" className="icon-button" onClick={() => setBook(null)} title="Unlink">
              <X size={16} />
              <span className="sr-only">Unlink the book</span>
            </button>
          </div>
        ) : picking ? (
          <BookSearch
            onPick={(b) => {
              setBook(b);
              setTitle(b.title);
              setAuthor(b.author || '');
              setPicking(false);
            }}
          />
        ) : (
          <button type="button" className="button button-small button-ghost" onClick={() => setPicking(true)}>
            <Search size={14} aria-hidden="true" /> Link a library book
          </button>
        )}
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Book title</span>
          <input name="bookTitle" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Things Fall Apart" required={!book} />
        </label>
        <label className="field">
          <span>Author</span>
          <input name="author" maxLength={200} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Chinua Achebe" />
        </label>
      </div>
      <ErrorMessage error={error} />
      <div className="button-row">
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save quote'}
        </button>
        <button type="button" className="button button-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BookSearch({ onPick }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const books = useBooks({ q, sort: 'recent', limit: 8 });
  const results = books.data?.pages[0]?.books ?? [];
  return (
    <>
      <label className="search search-compact">
        <Search size={18} aria-hidden="true" />
        <input type="search" placeholder="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search books" autoFocus />
      </label>
      <ul className="pick-list">
        {results.map((b) => (
          <li key={b.id}>
            <button type="button" className="pick" onClick={() => onPick(b)}>
              <BookCover book={b} size="tiny" />
              <span>
                <strong>{b.title}</strong>
                {b.author && <span className="muted small"> · {b.author}</span>}
              </span>
            </button>
          </li>
        ))}
        {books.isSuccess && results.length === 0 && <li className="muted small">No books match.</li>}
      </ul>
    </>
  );
}
