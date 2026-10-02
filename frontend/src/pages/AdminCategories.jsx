import { useState } from 'react';
import { BookPlus, FolderOpen, Pencil, Plus, Search, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, useBooks, useCategories, useCategoryStarters } from '../api/queries.js';
import BookCover from '../components/BookCover.jsx';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { formatNumber } from '../utils/format.js';
import { useDebounced } from '../utils/useDebounced.js';

// After any change to categories or which books are in them.
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.categories }),
      queryClient.invalidateQueries({ queryKey: keys.categoryStarters }),
      queryClient.invalidateQueries({ queryKey: ['books'] }),
      queryClient.invalidateQueries({ queryKey: ['book'] }),
    ]);
}

const assign = (assignments) => api('/categories/books', { method: 'PUT', body: { assignments } });

// Admins keep the list of categories, file existing books under them (by hand or by letting A-Read
// work it out from each book), and readers browse the library by them.
export default function AdminCategories() {
  const refresh = useRefresh();
  const { data: categories, isPending, error } = useCategories();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const run = async (request) => {
    setBusy(true);
    setActionError(null);
    try {
      await request();
      await refresh();
      return true;
    } catch (err) {
      setActionError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const formBody = (form) => ({
    name: form.elements.name.value,
    description: form.elements.description.value,
    keywords: form.elements.keywords.value,
  });
  const add = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (await run(() => api('/categories', { method: 'POST', body: formBody(form) }))) form.reset();
  };
  const save = async (event, category) => {
    event.preventDefault();
    const body = formBody(event.currentTarget);
    if (await run(() => api(`/categories/${category.id}`, { method: 'PATCH', body }))) setEditing(null);
  };
  const remove = (category) => {
    const books = category.books ? ` Its ${category.books} book${category.books === 1 ? '' : 's'} stay in the library without a category.` : '';
    if (window.confirm(`Delete the category "${category.name}"?${books}`)) run(() => api(`/categories/${category.id}`, { method: 'DELETE' }));
  };

  return (
    <div className="stack">
      <Starters />

      <section className="panel">
        <h2 className="panel-title">
          <Plus size={18} aria-hidden="true" /> New category
        </h2>
        <form className="form category-form" onSubmit={add}>
          <CategoryFields />
          <button className="button button-primary" disabled={busy}>
            Add category
          </button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">
          <FolderOpen size={18} aria-hidden="true" /> Categories
        </h2>
        <ErrorMessage error={error || actionError} />
        {isPending && <Spinner label="Loading…" />}
        {categories?.length === 0 && <p className="muted">No categories yet. Add the common ones above, or your own.</p>}
        {categories?.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Books</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {categories.map((c) =>
                  editing === c.id ? (
                    <tr key={c.id}>
                      <td colSpan={3}>
                        <form className="form category-form" onSubmit={(e) => save(e, c)}>
                          <CategoryFields category={c} />
                          <div className="button-row">
                            <button className="button button-primary button-small" disabled={busy}>
                              Save
                            </button>
                            <button type="button" className="button button-ghost button-small" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <CategoryRow
                      key={c.id}
                      category={c}
                      busy={busy}
                      adding={adding === c.id}
                      onAdd={() => setAdding(adding === c.id ? null : c.id)}
                      onEdit={() => setEditing(c.id)}
                      onRemove={() => remove(c)}
                    />
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {categories?.length > 0 && <AutoSort categories={categories} />}
    </div>
  );
}

function CategoryFields({ category }) {
  return (
    <>
      <label className="field">
        <span>Name</span>
        <input name="name" required maxLength={60} defaultValue={category?.name} placeholder="e.g. Fiction, History, Children" autoFocus={Boolean(category)} />
      </label>
      <label className="field">
        <span>Description (optional)</span>
        <input name="description" maxLength={300} defaultValue={category?.description} placeholder="Shown at the top of the category in the library" />
      </label>
      <label className="field category-keywords">
        <span>Keywords (optional)</span>
        <input
          name="keywords"
          maxLength={2000}
          defaultValue={category?.keywords?.join(', ')}
          placeholder="Words typical of these books, e.g. war, empire, colonial"
        />
      </label>
    </>
  );
}

function CategoryRow({ category: c, busy, adding, onAdd, onEdit, onRemove }) {
  return (
    <>
      <tr>
        <td>
          <Link to={`/?category=${encodeURIComponent(c.slug)}`}>
            <strong>{c.name}</strong>
          </Link>
          {c.description && <div className="muted small">{c.description}</div>}
          {c.keywords?.length > 0 && <div className="muted small">Keywords: {c.keywords.join(', ')}</div>}
        </td>
        <td className="num">{formatNumber(c.books)}</td>
        <td className="actions">
          <button type="button" className={`button button-small ${adding ? '' : 'button-ghost'}`} onClick={onAdd} disabled={busy}>
            <BookPlus size={14} aria-hidden="true" /> Add books
          </button>
          <button type="button" className="icon-button" onClick={onEdit} title="Edit" disabled={busy}>
            <Pencil size={16} />
            <span className="sr-only">Edit {c.name}</span>
          </button>
          <button type="button" className="icon-button danger" onClick={onRemove} title="Delete category" disabled={busy}>
            <Trash2 size={16} />
            <span className="sr-only">Delete {c.name}</span>
          </button>
        </td>
      </tr>
      {adding && (
        <tr className="add-books-row">
          <td colSpan={3}>
            <AddBooks category={c} onDone={onAdd} />
          </td>
        </tr>
      )}
    </>
  );
}

// Pick existing books from the library and file them under one category.
function AddBooks({ category, onDone }) {
  const refresh = useRefresh();
  const [query, setQuery] = useState('');
  const [onlyUnfiled, setOnlyUnfiled] = useState(true);
  const [picked, setPicked] = useState(() => new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const q = useDebounced(query.trim(), 300);
  const books = useBooks({ q, category: onlyUnfiled ? 'none' : '', sort: 'title', limit: 30 });
  const list = (books.data?.pages.flatMap((p) => p.books) ?? []).filter((b) => b.category?.id !== category.id);

  const toggle = (book) =>
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(book.id)) next.delete(book.id);
      else next.set(book.id, book);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await assign([...picked.keys()].map((bookId) => ({ bookId, categoryId: category.id })));
      await refresh();
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add-books">
      <div className="add-books-head">
        <label className="search search-compact">
          <Search size={18} aria-hidden="true" />
          <input type="search" placeholder="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search books" autoFocus />
        </label>
        <label className="checkbox small">
          <input type="checkbox" checked={onlyUnfiled} onChange={(e) => setOnlyUnfiled(e.target.checked)} /> Only books without a category
        </label>
      </div>
      <ul className="pick-list add-books-list">
        {list.map((b) => (
          <li key={b.id}>
            <label className="pick">
              <input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b)} />
              <BookCover book={b} size="tiny" />
              <span>
                <strong>{b.title}</strong>
                {b.author && <span className="muted small"> · {b.author}</span>}
                {b.category && <span className="badge">{b.category.name}</span>}
              </span>
            </label>
          </li>
        ))}
        {books.isPending && <li className="muted small">Loading…</li>}
        {books.isSuccess && list.length === 0 && <li className="muted small">No books match.</li>}
      </ul>
      {books.hasNextPage && (
        <button type="button" className="button button-small button-ghost" onClick={() => books.fetchNextPage()} disabled={books.isFetchingNextPage}>
          Show more
        </button>
      )}
      <ErrorMessage error={error} />
      <div className="button-row">
        <button type="button" className="button button-primary button-small" onClick={save} disabled={!picked.size || busy}>
          {busy ? 'Saving…' : `Add ${picked.size || ''} book${picked.size === 1 ? '' : 's'} to ${category.name}`}
        </button>
        <button type="button" className="button button-ghost button-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Common categories the library doesn't have yet, added in one click.
function Starters() {
  const refresh = useRefresh();
  const { data: starters } = useCategoryStarters();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!starters?.length) return null;
  const add = async (names) => {
    setBusy(true);
    setError(null);
    try {
      await api('/categories/starters', { method: 'POST', body: { names } });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h2 className="panel-title">
        <Sparkles size={18} aria-hidden="true" /> Common categories
      </h2>
      <p className="muted small">A-Read already knows the words typical of these, so it can sort books into them straight away.</p>
      <div className="tag-row">
        {starters.map((name) => (
          <button key={name} type="button" className="chip" onClick={() => add([name])} disabled={busy}>
            <Plus size={12} aria-hidden="true" /> {name}
          </button>
        ))}
      </div>
      <ErrorMessage error={error} />
      <button type="button" className="button button-small" onClick={() => add(starters)} disabled={busy}>
        Add all {starters.length}
      </button>
    </section>
  );
}

const SCOPES = [
  ['uncategorized', 'Books without a category'],
  ['auto', 'Books A-Read sorted automatically'],
  ['all', 'Every book'],
];
const CONFIDENCE = { strong: 'Strong match', likely: 'Likely' };

// Lets A-Read read each book and suggest its category. Nothing changes until the admin applies
// the suggestions they keep (each can be changed or unticked first).
function AutoSort({ categories }) {
  const refresh = useRefresh();
  const [scope, setScope] = useState('uncategorized');
  const [result, setResult] = useState(null);
  const [choice, setChoice] = useState({});
  const [checked, setChecked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const find = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const data = await api('/categories/suggest', { method: 'POST', body: { scope, limit: 300 } });
      setResult(data);
      setChoice(Object.fromEntries(data.suggestions.map((s) => [s.book.id, s.suggestion.category?.id ?? s.book.category?.id ?? ''])));
      setChecked(new Set(data.suggestions.filter((s) => s.suggestion.category && s.suggestion.category.id !== s.book.category?.id).map((s) => s.book.id)));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const changes = (result?.suggestions ?? []).filter((s) => checked.has(s.book.id) && (choice[s.book.id] || null) !== (s.book.category?.id ?? null));
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await assign(changes.map((s) => ({ bookId: s.book.id, categoryId: choice[s.book.id] || null })));
      setDone(`Filed ${changes.length} book${changes.length === 1 ? '' : 's'}.`);
      setResult(null);
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="panel auto-sort">
      <h2 className="panel-title">
        <Wand2 size={18} aria-hidden="true" /> Sort books automatically
      </h2>
      <p className="muted small">
        A-Read reads each book (its title, tags, description, chapter titles and text from across the book) and compares it with
        each category&apos;s name and keywords, the words typical of common categories, and the books already filed there. You
        check the suggestions before anything changes. New uploads without a category are sorted the same way.
      </p>
      <div className="auto-sort-controls">
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Which books">
          {SCOPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="button button-primary" onClick={find} disabled={busy}>
          {busy && !result ? 'Reading the books…' : 'Find categories'}
        </button>
      </div>
      {done && <p className="notice">{done}</p>}
      <ErrorMessage error={error} />
      {result && (
        <>
          <p className="muted small">
            Read {formatNumber(result.scanned)} of {formatNumber(result.total)} book{result.total === 1 ? '' : 's'}.{' '}
            {result.suggestions.filter((s) => s.suggestion.category).length} have a suggestion
            {result.total > result.scanned ? '; apply these, then run it again for the rest' : ''}.
          </p>
          {result.suggestions.length === 0 ? (
            <p className="muted">No books to sort here.</p>
          ) : (
            <div className="table-wrap">
              <table className="table auto-sort-table">
                <thead>
                  <tr>
                    <th aria-label="Apply" />
                    <th>Book</th>
                    <th>Now</th>
                    <th>File under</th>
                  </tr>
                </thead>
                <tbody>
                  {result.suggestions.map(({ book, suggestion }) => (
                    <tr key={book.id} className={suggestion.category ? '' : 'no-match'}>
                      <td>
                        <input type="checkbox" checked={checked.has(book.id)} onChange={() => toggle(book.id)} aria-label={`Apply to ${book.title}`} />
                      </td>
                      <td>
                        <Link to={`/books/${book.id}`} className="table-book">
                          <BookCover book={book} size="tiny" />
                          <div>
                            <strong>{book.title}</strong>
                            {book.author && <div className="muted small">{book.author}</div>}
                          </div>
                        </Link>
                      </td>
                      <td className="small">
                        {book.category ? book.category.name : <span className="muted">None</span>}
                        {book.categorySource === 'auto' && <span className="badge">auto</span>}
                      </td>
                      <td>
                        <select
                          value={choice[book.id] ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setChoice((c) => ({ ...c, [book.id]: value }));
                            setChecked((current) => new Set(current).add(book.id));
                          }}
                          aria-label={`Category for ${book.title}`}
                        >
                          <option value="">No category</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <div className="muted small suggestion-why">
                          {suggestion.category ? (
                            <>
                              <span className={`status-pill confidence-${suggestion.confidence}`}>{CONFIDENCE[suggestion.confidence]}</span>{' '}
                              {suggestion.reasons.join(', ')}
                            </>
                          ) : (
                            'Not sure: no category stands out'
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={apply} disabled={busy || !changes.length}>
              {busy ? 'Saving…' : `Apply ${changes.length} change${changes.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="button button-ghost" onClick={() => setResult(null)} disabled={busy}>
              <X size={14} aria-hidden="true" /> Close
            </button>
          </div>
        </>
      )}
    </section>
  );
}
