import { useState } from 'react';
import { BookmarkPlus, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { keys, useBookmarks } from '../api/queries.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { formatDuration, timeAgo } from '../utils/format.js';
import SettingsPanel from './SettingsPanel.jsx';

const TITLES = { contents: 'Contents', bookmarks: 'Bookmarks', settings: 'Reading settings' };

export default function ReaderSidebar({ panel, onClose, book, sections, currentSection, onJump, makeBookmark }) {
  return (
    <aside className="reader-sidebar" aria-label={TITLES[panel]}>
      <div className="sidebar-header">
        <h2>{TITLES[panel]}</h2>
        <button type="button" className="icon-button" onClick={onClose} title="Close">
          <X size={18} />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className="sidebar-body">
        {panel === 'contents' && <Contents book={book} sections={sections} currentSection={currentSection} onJump={onJump} />}
        {panel === 'bookmarks' && <Bookmarks book={book} sections={sections} onJump={onJump} makeBookmark={makeBookmark} />}
        {panel === 'settings' && <SettingsPanel language={book.language} />}
      </div>
    </aside>
  );
}

function Contents({ book, sections, currentSection, onJump }) {
  const entries = book.toc?.length ? book.toc : sections.map((s) => ({ title: s.title, sectionIndex: s.index, depth: 0 }));
  // Highlight the last entry at or before the current section.
  let activeEntry = -1;
  entries.forEach((entry, i) => {
    if (entry.sectionIndex <= currentSection) activeEntry = i;
  });
  return (
    <ol className="toc-list">
      {entries.map((entry, i) => (
        <li key={`${entry.sectionIndex}-${i}`} style={{ paddingLeft: `${entry.depth * 14}px` }}>
          <button type="button" className={`toc-link ${i === activeEntry ? 'active' : ''}`} onClick={() => onJump({ sectionIndex: entry.sectionIndex, sentenceIndex: 0 })}>
            {entry.title}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Bookmarks({ book, sections, onJump, makeBookmark }) {
  const queryClient = useQueryClient();
  const { data: bookmarks, isPending, error } = useBookmarks(book.id);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.bookmarks(book.id) });

  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await api(`/books/${book.id}/bookmarks`, { method: 'POST', body: { ...makeBookmark(), note } });
      setNote('');
      refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    setActionError(null);
    try {
      await api(`/bookmarks/${id}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      setActionError(err);
    }
  };

  return (
    <div className="bookmarks">
      <form className="bookmark-form" onSubmit={add}>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" maxLength={2000} />
        <button className="button button-primary button-small" disabled={busy}>
          <BookmarkPlus size={16} aria-hidden="true" /> Bookmark here
        </button>
      </form>
      <ErrorMessage error={error || actionError} />
      {isPending && <Spinner label="Loading…" />}
      {bookmarks?.length === 0 && <p className="muted small">No bookmarks yet. Bookmarks are private to you.</p>}
      <ul className="bookmark-list">
        {bookmarks?.map((b) => (
          <li key={b.id} className="bookmark">
            <button type="button" className="bookmark-jump" onClick={() => onJump(b)}>
              <span className="bookmark-where">
                {b.label || sections[b.sectionIndex]?.title || `Section ${b.sectionIndex + 1}`}
                {b.audiobookTime != null && <> · {formatDuration(b.audiobookTime)}</>}
              </span>
              {b.snippet && <span className="bookmark-snippet">“{b.snippet}”</span>}
              {b.note && <span className="bookmark-note">{b.note}</span>}
              <span className="muted small">{timeAgo(b.createdAt)}</span>
            </button>
            <button type="button" className="icon-button" onClick={() => remove(b.id)} title="Delete bookmark">
              <Trash2 size={16} />
              <span className="sr-only">Delete bookmark</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
