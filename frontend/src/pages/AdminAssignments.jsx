import { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Plus, Search, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, useAdminUsers, useAssignmentReport, useAssignments, useBooks } from '../api/queries.js';
import BookCover from '../components/BookCover.jsx';
import { ErrorMessage, ProgressBar, Spinner } from '../components/Feedback.jsx';
import { useAuthConfig } from '../components/GoogleButton.jsx';
import { dueLabel } from '../components/RequiredShelf.jsx';
import { timeAgo } from '../utils/format.js';
import { useDebounced } from '../utils/useDebounced.js';

const STATUS_LABELS = { finished: 'Finished', reading: 'Reading', 'not-started': 'Not started', overdue: 'Overdue' };

export default function AdminAssignments() {
  const { data, isPending, error } = useAssignments();
  const [creating, setCreating] = useState(false);
  const [openReport, setOpenReport] = useState(null);
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState(null);

  const remove = async (a) => {
    if (!window.confirm(`Stop requiring "${a.book.title}"? Readers keep their progress.`)) return;
    try {
      await api(`/assignments/${a.id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'assignments'] });
      queryClient.invalidateQueries({ queryKey: keys.myAssignments });
    } catch (err) {
      setActionError(err);
    }
  };

  return (
    <div className="stack">
      {creating ? (
        <NewAssignment onDone={() => setCreating(false)} />
      ) : (
        <div>
          <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> Assign a book
          </button>
        </div>
      )}
      <section className="panel">
        <h2 className="panel-title">
          <CalendarClock size={18} aria-hidden="true" /> Required reading
        </h2>
        <ErrorMessage error={error || actionError} />
        {isPending && <Spinner label="Loading…" />}
        {data?.length === 0 && <p className="muted">Nothing assigned yet. Assign a book and readers will see it in their Required reading list.</p>}
        <ul className="assignment-admin-list">
          {data?.map((a) => (
            <li key={a.id}>
              <div className="assignment-row">
                <Link to={`/books/${a.book.id}`} className="table-book">
                  <BookCover book={a.book} size="tiny" />
                  <div>
                    <strong>{a.book.title}</strong>
                    <div className="muted small">
                      {a.everyone ? 'Everyone' : `${a.assigned} reader${a.assigned === 1 ? '' : 's'}`} · {dueLabel(a.dueDate)}
                    </div>
                  </div>
                </Link>
                <div className="assignment-completion">
                  <span className="small">
                    {a.finished}/{a.assigned} finished
                  </span>
                  <ProgressBar value={a.assigned ? (a.finished / a.assigned) * 100 : 0} label="Completion" />
                </div>
                <div className="actions">
                  <button type="button" className="button button-small button-ghost" onClick={() => setOpenReport(openReport === a.id ? null : a.id)}>
                    {openReport === a.id ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />} Readers
                  </button>
                  <button type="button" className="icon-button danger" onClick={() => remove(a)} title="Remove assignment">
                    <Trash2 size={16} />
                    <span className="sr-only">Remove assignment</span>
                  </button>
                </div>
              </div>
              {a.note && <p className="muted small assignment-admin-note">{a.note}</p>}
              {openReport === a.id && <Report id={a.id} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Report({ id }) {
  const { data, isPending, error } = useAssignmentReport(id);
  if (isPending) return <Spinner label="Loading readers…" />;
  if (error) return <ErrorMessage error={error} />;
  return (
    <div className="table-wrap report">
      <table className="table">
        <thead>
          <tr>
            <th>Reader</th>
            <th>Status</th>
            <th className="num">Progress</th>
            <th>Last read</th>
          </tr>
        </thead>
        <tbody>
          {data.readers.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.name}</strong>
                <div className="muted small">{r.email}</div>
              </td>
              <td>
                <span className={`status-pill status-${r.status}`}>{STATUS_LABELS[r.status]}</span>
              </td>
              <td className="num">{Math.round(r.percent)}%</td>
              <td className="muted small">{r.lastReadAt ? timeAgo(r.lastReadAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewAssignment({ onDone }) {
  const queryClient = useQueryClient();
  const { data: config } = useAuthConfig();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const books = useBooks({ q, sort: 'recent', limit: 8 });
  const results = books.data?.pages[0]?.books ?? [];
  const { data: users } = useAdminUsers('');
  const [book, setBook] = useState(null);
  const [everyone, setEveryone] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggleUser = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!book) {
      setError(new Error('Pick a book first'));
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('/assignments', {
        method: 'POST',
        body: {
          bookId: book.id,
          dueDate: form.get('dueDate') || null,
          note: form.get('note') || '',
          everyone,
          userIds: everyone ? [] : [...selected],
          notify: form.get('notify') === 'on',
        },
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'assignments'] });
      queryClient.invalidateQueries({ queryKey: keys.myAssignments });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className="panel form" onSubmit={onSubmit}>
      <h2 className="panel-title">Assign a book</h2>
      <div className="field">
        <span>Book</span>
        {book ? (
          <div className="picked-book">
            <BookCover book={book} size="tiny" />
            <div>
              <strong>{book.title}</strong>
              {book.author && <div className="muted small">{book.author}</div>}
            </div>
            <button type="button" className="button button-small button-ghost" onClick={() => setBook(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <label className="search search-compact">
              <Search size={18} aria-hidden="true" />
              <input type="search" placeholder="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search books" />
            </label>
            <ul className="pick-list">
              {results.map((b) => (
                <li key={b.id}>
                  <button type="button" className="pick" onClick={() => setBook(b)}>
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
        )}
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Due date (optional)</span>
          <input type="date" name="dueDate" />
        </label>
        <label className="field">
          <span>Note to readers (optional)</span>
          <input name="note" maxLength={2000} placeholder="e.g. Read chapters 1–3 before Monday" />
        </label>
      </div>

      <fieldset className="setting">
        <legend>Who has to read it?</legend>
        <label className="checkbox">
          <input type="radio" name="audience" checked={everyone} onChange={() => setEveryone(true)} /> Everyone (including people who join later)
        </label>
        <label className="checkbox">
          <input type="radio" name="audience" checked={!everyone} onChange={() => setEveryone(false)} /> Selected readers
        </label>
        {!everyone && (
          <ul className="user-picks">
            {(users || []).map((u) => (
              <li key={u.id}>
                <label className="checkbox">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleUser(u.id)} />
                  {u.name} <span className="muted small">{u.email}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {config?.emailVerification && (
        <label className="checkbox">
          <input type="checkbox" name="notify" defaultChecked /> Email readers about it
        </label>
      )}

      <ErrorMessage error={error} />
      <div className="button-row">
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Assigning…' : 'Assign'}
        </button>
        <button type="button" className="button button-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
