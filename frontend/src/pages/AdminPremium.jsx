import { useEffect, useMemo, useRef, useState } from 'react';
import { Crown, Lock, LockOpen, Pencil, Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, useAdminPremium, useBook, useBookPremium, useBooks, usePaymentConfig, useSections } from '../api/queries.js';
import BookCover from '../components/BookCover.jsx';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { formatKes, formatNumber, partName } from '../utils/format.js';
import { useDebounced } from '../utils/useDebounced.js';

// Admins choose which books are premium, what they cost, and which chapters stay locked until a
// reader pays (by M-Pesa, once per book).
export default function AdminPremium() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('book');
  const select = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('book', id);
    else next.delete('book');
    setParams(next, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const { data: books, isPending, error } = useAdminPremium();

  return (
    <div className="stack">
      {selected ? <PremiumEditor key={selected} bookId={selected} onClose={() => select(null)} /> : <PickBook onPick={select} />}

      <section className="panel">
        <h2 className="panel-title">
          <Crown size={18} aria-hidden="true" /> Premium books
        </h2>
        <p className="muted small">
          Readers see every chapter's title, read the free ones, and pay once to unlock the rest. Whoever uploaded a book and
          admins can always read all of it.
        </p>
        <ErrorMessage error={error} />
        {isPending && <Spinner label="Loading…" />}
        {books?.length === 0 && <p className="muted">No premium books yet. Search for a book above to set a price and lock chapters.</p>}
        {books?.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Status</th>
                  <th className="num">Price</th>
                  <th>Locked</th>
                  <th className="num">Sold</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/books/${b.id}`} className="table-book">
                        <BookCover book={b} size="tiny" />
                        <div>
                          <strong>{b.title}</strong>
                          {b.author && <div className="muted small">{b.author}</div>}
                        </div>
                      </Link>
                    </td>
                    <td>
                      <span className={`status-pill ${b.premium.enabled ? 'premium-on' : ''}`}>{b.premium.enabled ? 'Premium' : 'Free (paused)'}</span>
                    </td>
                    <td className="num">{b.premium.price ? formatKes(b.premium.price) : '—'}</td>
                    <td className="small">
                      {formatNumber(b.premium.lockedSections.length)} of {formatNumber(b.sectionCount)} {partName(b.format, b.sectionCount)}
                    </td>
                    <td className="num small">
                      {formatKes(b.sales.amount)}
                      <div className="muted small">
                        {b.sales.count} sale{b.sales.count === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td className="actions">
                      <button type="button" className="button button-small button-ghost" onClick={() => select(b.id)}>
                        <Pencil size={14} aria-hidden="true" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PickBook({ onPick }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const books = useBooks({ q, sort: 'recent', limit: 8 });
  const results = books.data?.pages[0]?.books ?? [];
  return (
    <section className="panel form">
      <h2 className="panel-title">
        <Lock size={18} aria-hidden="true" /> Make a book premium
      </h2>
      <label className="search search-compact">
        <Search size={18} aria-hidden="true" />
        <input type="search" placeholder="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search books" />
      </label>
      <ul className="pick-list">
        {results.map((b) => (
          <li key={b.id}>
            <button type="button" className="pick" onClick={() => onPick(b.id)}>
              <BookCover book={b} size="tiny" />
              <span>
                <strong>{b.title}</strong>
                {b.author && <span className="muted small"> · {b.author}</span>}
                {b.premium && <span className="badge badge-premium">Premium</span>}
              </span>
            </button>
          </li>
        ))}
        {books.isSuccess && results.length === 0 && <li className="muted small">No books match.</li>}
      </ul>
    </section>
  );
}

function PremiumEditor({ bookId, onClose }) {
  const book = useBook(bookId);
  const sections = useSections(bookId);
  const saved = useBookPremium(bookId);
  const error = book.error || sections.error || saved.error;
  if (!book.data || !sections.data || !saved.data) {
    return (
      <section className="panel">
        {error ? <ErrorMessage error={error} /> : <Spinner label="Loading the book…" />}
        <button type="button" className="button button-ghost button-small" onClick={onClose}>
          Close
        </button>
      </section>
    );
  }
  return <PremiumForm book={book.data} sections={sections.data} saved={saved.data} onClose={onClose} />;
}

// PDF sections are pages, so pages are grouped under the PDF's top-level chapters when it has an
// outline. EPUB and TXT sections are already chapters.
function chapterGroups(book, sections) {
  const title = (s) => s.title || `${partName(book.format)} ${s.index + 1}`;
  const starts = new Map();
  if (book.format === 'pdf') {
    for (const entry of book.toc || []) {
      if (entry.depth === 0 && entry.sectionIndex >= 0 && entry.sectionIndex < sections.length && !starts.has(entry.sectionIndex)) {
        starts.set(entry.sectionIndex, entry.title);
      }
    }
  }
  if (!starts.size) return sections.map((s) => ({ title: title(s), from: s.index, to: s.index }));
  const indexes = [...starts.keys()].sort((a, b) => a - b);
  const groups = indexes[0] > 0 ? [{ title: 'Opening pages', from: 0, to: indexes[0] - 1 }] : [];
  indexes.forEach((from, i) => groups.push({ title: starts.get(from), from, to: (indexes[i + 1] ?? sections.length) - 1 }));
  return groups;
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function PremiumForm({ book, sections, saved, onClose }) {
  const queryClient = useQueryClient();
  const { data: config } = usePaymentConfig();
  const count = sections.length;
  const [enabled, setEnabled] = useState(saved.enabled || !saved.price);
  const [price, setPrice] = useState(saved.price ?? '');
  const [locked, setLocked] = useState(() => new Set(saved.lockedSections));
  const [freeCount, setFreeCount] = useState(() => Math.min(Math.max(count - 1, 0), book.format === 'pdf' ? 10 : 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const groups = useMemo(() => chapterGroups(book, sections), [book, sections]);
  const parts = (n) => `${formatNumber(n)} ${partName(book.format, n)}`;

  const toggleGroup = (group) =>
    setLocked((current) => {
      const next = new Set(current);
      const all = range(group.from, group.to).every((i) => next.has(i));
      for (const i of range(group.from, group.to)) {
        if (all) next.delete(i);
        else next.add(i);
      }
      return next;
    });

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/books/${book.id}/premium`, {
        method: 'PUT',
        body: { enabled, price: price === '' ? undefined : Number(price), lockedSections: [...locked] },
      });
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: keys.adminPremium });
      queryClient.invalidateQueries({ queryKey: keys.adminStats });
      queryClient.invalidateQueries({ queryKey: keys.book(book.id) });
      queryClient.invalidateQueries({ queryKey: keys.sections(book.id) });
      queryClient.invalidateQueries({ queryKey: ['books'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel form premium-editor" onSubmit={onSubmit}>
      <div className="premium-editor-head">
        <Link to={`/books/${book.id}`} className="table-book">
          <BookCover book={book} size="tiny" />
          <div>
            <strong>{book.title}</strong>
            <div className="muted small">
              {book.author ? `${book.author} · ` : ''}
              {parts(count)}
            </div>
          </div>
        </Link>
        <button type="button" className="icon-button" onClick={onClose} title="Close">
          <X size={18} />
          <span className="sr-only">Close</span>
        </button>
      </div>

      <label className="checkbox premium-switch">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>
          <strong>Premium</strong>: readers pay to open the locked {partName(book.format, 2)}
        </span>
      </label>

      <label className="field premium-price">
        <span>Price to unlock (KES)</span>
        <input
          type="number"
          inputMode="numeric"
          min={config?.minAmount ?? 1}
          max={config?.maxAmount}
          step={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required={enabled}
        />
      </label>

      <fieldset className="setting">
        <legend>
          Locked {partName(book.format, 2)} · {formatNumber(locked.size)} of {formatNumber(count)}
        </legend>
        <div className="premium-quick">
          <label className="premium-quick-free">
            Keep the first
            <input
              type="number"
              min={0}
              max={count}
              value={freeCount}
              onChange={(e) => setFreeCount(Math.min(count, Math.max(0, Number(e.target.value) || 0)))}
              aria-label={`Free ${partName(book.format, 2)}`}
            />
            {partName(book.format, freeCount)} free
          </label>
          <button type="button" className="button button-small" onClick={() => setLocked(new Set(range(freeCount, count - 1)))}>
            Lock the rest
          </button>
          <button type="button" className="button button-small button-ghost" onClick={() => setLocked(new Set(range(0, count - 1)))}>
            Lock all
          </button>
          <button type="button" className="button button-small button-ghost" onClick={() => setLocked(new Set())}>
            Unlock all
          </button>
        </div>
        <ul className="chapter-picker">
          {groups.map((group) => (
            <ChapterRow key={group.from} group={group} locked={locked} format={book.format} sections={sections} onToggle={() => toggleGroup(group)} />
          ))}
        </ul>
      </fieldset>

      <ErrorMessage error={error} />
      <div className="button-row">
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save premium settings'}
        </button>
        {savedAt && !busy && !error && (
          <span className="muted small">
            Saved. {enabled ? `Readers now pay ${formatKes(Number(price))} to open ${parts(locked.size)}.` : 'The book is free for everyone.'}
          </span>
        )}
      </div>
      <p className="muted small">
        Readers who already paid keep the whole book. When a book is premium, its original file is only given to readers who can
        open every chapter, so page view needs an unlocked book.
      </p>
    </form>
  );
}

function ChapterRow({ group, locked, format, sections, onToggle }) {
  const input = useRef(null);
  const indexes = range(group.from, group.to);
  const lockedCount = indexes.filter((i) => locked.has(i)).length;
  const all = lockedCount === indexes.length;
  useEffect(() => {
    if (input.current) input.current.indeterminate = lockedCount > 0 && !all;
  }, [lockedCount, all]);
  const words = indexes.reduce((n, i) => n + (sections[i]?.wordCount || 0), 0);
  const where = format === 'pdf' ? (group.from === group.to ? `page ${group.from + 1}` : `pages ${group.from + 1}–${group.to + 1}`) : null;
  return (
    <li className={all ? 'is-locked' : ''}>
      <label>
        <input ref={input} type="checkbox" checked={all} onChange={onToggle} />
        {all ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" className="muted" />}
        <span className="chapter-title">{group.title}</span>
        <span className="muted small">{[where, `${formatNumber(words)} words`].filter(Boolean).join(' · ')}</span>
      </label>
    </li>
  );
}
