import { useEffect, useRef, useState } from 'react';
import { BookOpen, Headphones, ImagePlus, Music, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, upload } from '../api/client.js';
import {
  keys,
  useBook,
  useBookMutation,
  useNarrationStatus,
  useSections,
  useTtsStatus,
  useVoices,
} from '../api/queries.js';
import BookCover from '../components/BookCover.jsx';
import FileDrop from '../components/FileDrop.jsx';
import { ErrorMessage, PageLoader, ProgressBar, Spinner } from '../components/Feedback.jsx';
import NotFoundPage from './NotFoundPage.jsx';
import {
  FORMAT_LABELS,
  formatDuration,
  formatHours,
  formatNumber,
  listeningMinutes,
  readingMinutes,
  timeAgo,
} from '../utils/format.js';

export default function BookPage() {
  const { id } = useParams();
  const { data: book, isPending, error } = useBook(id);
  const [editing, setEditing] = useState(false);

  if (isPending) return <PageLoader label="Loading book…" />;
  if (error?.status === 404 || error?.status === 400) return <NotFoundPage />;
  if (error) return <ErrorMessage error={error} />;

  const percent = book.progress?.percent ?? 0;
  const noText = book.wordCount === 0;
  return (
    <div className="book-page">
      <div className="book-hero">
        <BookCover book={book} size="large" />
        <div className="book-info">
          <div className="book-badges">
            <span className="badge">{FORMAT_LABELS[book.format]}</span>
            {book.hasAudio && (
              <span className="badge badge-accent">
                <Headphones size={12} aria-hidden="true" /> Audio
              </span>
            )}
          </div>
          <h1 className="book-title">{book.title}</h1>
          {book.author && <p className="book-author">by {book.author}</p>}
          <p className="muted book-stats">
            {formatNumber(book.wordCount)} words · {formatHours(readingMinutes(book.wordCount))} to read ·{' '}
            {formatHours(listeningMinutes(book.wordCount))} to listen
            <br />
            Uploaded by {book.uploadedBy?.name || 'someone'} {timeAgo(book.createdAt)}
          </p>
          {book.tags?.length > 0 && (
            <div className="tag-row">
              {book.tags.map((tag) => (
                <Link key={tag} to={`/?tag=${encodeURIComponent(tag)}`} className="chip">
                  #{tag}
                </Link>
              ))}
            </div>
          )}
          {percent > 0 && (
            <div className="book-progress">
              <ProgressBar value={percent} label="Reading progress" />
              <span className="muted">{Math.round(percent)}% read</span>
            </div>
          )}
          <div className="button-row">
            <Link to={`/read/${book.id}`} className="button button-primary">
              <BookOpen size={18} aria-hidden="true" /> {percent > 0 ? 'Continue reading' : 'Start reading'}
            </Link>
            {(!noText || book.audiobook) && (
              <Link to={`/read/${book.id}?listen=1`} className="button">
                <Headphones size={18} aria-hidden="true" /> Listen
              </Link>
            )}
            {book.canEdit && (
              <button type="button" className="button button-ghost" onClick={() => setEditing((v) => !v)}>
                <Pencil size={16} aria-hidden="true" /> {editing ? 'Close editor' : 'Edit'}
              </button>
            )}
          </div>
          {noText && (
            <p className="notice">
              No text could be extracted from this book (scanned PDFs are images of pages). You can still read it in page
              view, but it can't be read aloud unless you upload an audiobook.
            </p>
          )}
          {book.description && <p className="book-description">{book.description}</p>}
        </div>
      </div>

      {editing && <EditBook book={book} onDone={() => setEditing(false)} />}

      <div className="book-columns">
        <Contents book={book} />
        <div className="stack">
          <NarrationPanel book={book} />
          <AudiobookPanel book={book} />
        </div>
      </div>
    </div>
  );
}

function Contents({ book }) {
  const { data: sections, isPending } = useSections(book.id);
  const entries = book.toc?.length
    ? book.toc
    : (sections || []).map((s) => ({ title: s.title, sectionIndex: s.index, depth: 0 }));
  return (
    <section className="panel">
      <h2 className="panel-title">Contents</h2>
      {isPending && !book.toc?.length ? (
        <Spinner label="Loading…" />
      ) : (
        <ol className="toc-list">
          {entries.slice(0, 400).map((entry, i) => (
            <li key={`${entry.sectionIndex}-${i}`} style={{ paddingLeft: `${entry.depth * 16}px` }}>
              <Link to={`/read/${book.id}?section=${entry.sectionIndex}`}>{entry.title}</Link>
            </li>
          ))}
        </ol>
      )}
      {entries.length > 400 && <p className="muted">Showing the first 400 entries. Open the reader for the rest.</p>}
    </section>
  );
}

function NarrationPanel({ book }) {
  const queryClient = useQueryClient();
  const { data: tts } = useTtsStatus();
  const { data } = useNarrationStatus(book.id, { initiallyRunning: book.narration?.status === 'generating' });
  const narration = data?.narration ?? book.narration ?? { status: 'none' };
  const running = data?.running ?? narration.status === 'generating';
  const wasRunning = useRef(running);
  const language = (book.language || 'en').slice(0, 2).toLowerCase();
  const canGenerate = book.canEdit && tts?.enabled && book.wordCount > 0;
  const { data: voices, error: voicesError } = useVoices(language, Boolean(canGenerate));
  const [voice, setVoice] = useState('');
  const { data: sections } = useSections(book.id);
  const totalDuration = (sections || []).reduce((sum, s) => sum + (s.narrationDuration || 0), 0);

  // Refresh the book and its sections once a job finishes.
  useEffect(() => {
    if (wasRunning.current && !running) {
      queryClient.invalidateQueries({ queryKey: keys.book(book.id) });
      queryClient.invalidateQueries({ queryKey: keys.sections(book.id) });
      queryClient.invalidateQueries({ queryKey: ['section', book.id] });
    }
    wasRunning.current = running;
  }, [running, book.id, queryClient]);

  const chosenVoice = voice || narration.voice || voices?.find((v) => v.name === tts?.defaultVoice)?.name || voices?.[0]?.name || '';

  const start = useBookMutation(book.id, () => api(`/books/${book.id}/narration`, { method: 'POST', body: { voice: chosenVoice } }), {
    onSuccess: (result) => queryClient.setQueryData(keys.narration(book.id), result),
  });
  const stop = useBookMutation(book.id, () => api(`/books/${book.id}/narration`, { method: 'DELETE' }), {
    onSuccess: (result) => queryClient.setQueryData(keys.narration(book.id), result),
  });
  const purge = useBookMutation(book.id, () => api(`/books/${book.id}/narration?purge=true`, { method: 'DELETE' }), {
    onSuccess: (result) => {
      queryClient.setQueryData(keys.narration(book.id), result);
      queryClient.invalidateQueries({ queryKey: keys.book(book.id) });
      queryClient.invalidateQueries({ queryKey: keys.sections(book.id) });
      queryClient.invalidateQueries({ queryKey: ['section', book.id] });
    },
  });

  const percent = narration.totalSections ? (narration.completedSections / narration.totalSections) * 100 : 0;

  return (
    <section className="panel">
      <h2 className="panel-title">
        <Sparkles size={18} aria-hidden="true" /> Cloud narration
      </h2>
      <p className="muted small">
        Natural-sounding Google Cloud voices with the current sentence highlighted as it's read. Every reader can always use
        their device's built-in voice for free, too.
      </p>

      {running && (
        <div className="stack-sm">
          <span>
            Generating with <strong>{narration.voice}</strong>: {narration.completedSections} of {narration.totalSections}{' '}
            sections done
          </span>
          <ProgressBar value={percent} label="Narration progress" />
          {book.canEdit && (
            <button type="button" className="button button-small" onClick={() => stop.mutate()} disabled={stop.isPending}>
              Stop
            </button>
          )}
        </div>
      )}

      {!running && narration.status === 'ready' && (
        <p>
          Ready, narrated by <strong>{narration.voice}</strong>
          {totalDuration > 0 && <> · {formatDuration(totalDuration)}</>}.{' '}
          <Link to={`/read/${book.id}?listen=narration`}>Listen now</Link>
        </p>
      )}
      {!running && narration.status === 'partial' && (
        <p>
          {narration.completedSections} of {narration.totalSections} sections narrated ({narration.voice}).
        </p>
      )}
      {!running && narration.status === 'failed' && (
        <ErrorMessage>Narration stopped: {narration.error || 'unknown error'}. Start it again to resume.</ErrorMessage>
      )}

      {!running && book.canEdit && (
        <>
          {!tts?.enabled && <p className="notice small">Cloud narration isn't set up on this server (see README: Google Cloud TTS).</p>}
          {canGenerate && (
            <div className="stack-sm">
              <label className="field">
                <span>Voice</span>
                <select value={chosenVoice} onChange={(e) => setVoice(e.target.value)} disabled={!voices?.length}>
                  {(voices || []).map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} · {v.gender?.toLowerCase()} · {v.tier}
                    </option>
                  ))}
                </select>
              </label>
              <ErrorMessage error={voicesError || start.error || stop.error || purge.error} />
              <p className="muted small">
                About {formatNumber(book.charCount)} characters. Google bills per character beyond its free monthly tier.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="button button-primary button-small"
                  disabled={!chosenVoice || start.isPending}
                  onClick={() => start.mutate()}
                >
                  {narration.status === 'none' ? 'Generate narration' : narration.voice === chosenVoice && narration.status !== 'ready' ? 'Resume' : 'Generate again'}
                </button>
                {narration.status !== 'none' && (
                  <button
                    type="button"
                    className="button button-small button-danger-ghost"
                    disabled={purge.isPending}
                    onClick={() => window.confirm('Delete all narration audio for this book?') && purge.mutate()}
                  >
                    Delete narration
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {!book.canEdit && narration.status === 'none' && (
        <p className="muted small">Only the person who uploaded this book can generate narration.</p>
      )}
    </section>
  );
}

function AudiobookPanel({ book }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const attach = useBookMutation(book.id, () => {
    const form = new FormData();
    form.append('audio', file);
    setProgress(0);
    return upload(`/books/${book.id}/audiobook`, form, { onProgress: setProgress });
  }, {
    onSuccess: () => setFile(null),
    onSettled: () => setProgress(null),
  });
  const remove = useBookMutation(book.id, () => api(`/books/${book.id}/audiobook`, { method: 'DELETE' }));

  if (!book.audiobook && !book.canEdit) return null;
  return (
    <section className="panel">
      <h2 className="panel-title">
        <Music size={18} aria-hidden="true" /> Audiobook
      </h2>
      {book.audiobook ? (
        <div className="stack-sm">
          <p>
            <strong>{book.audiobook.originalName || 'Audiobook'}</strong>
            {book.audiobook.duration ? <> · {formatDuration(book.audiobook.duration)}</> : null}
            <br />
            <Link to={`/read/${book.id}?listen=audiobook`}>Listen now</Link>
          </p>
          {book.canEdit && (
            <button
              type="button"
              className="button button-small button-danger-ghost"
              disabled={remove.isPending}
              onClick={() => window.confirm('Remove the audiobook file?') && remove.mutate()}
            >
              Remove audiobook
            </button>
          )}
        </div>
      ) : (
        <p className="muted small">Attach a recording of this book (MP3, M4A, M4B, OGG, WAV, FLAC).</p>
      )}
      {book.canEdit && (
        <div className="stack-sm">
          <FileDrop
            accept="audio/*,.m4b"
            file={file}
            onFile={setFile}
            icon={Music}
            label={book.audiobook ? 'Replace the audiobook' : 'Upload an audiobook'}
            hint="One audio file for the whole book"
          />
          {progress !== null && (
            progress < 1 ? <ProgressBar value={progress * 100} label="Upload progress" /> : <Spinner label="Saving…" />
          )}
          <ErrorMessage error={attach.error || remove.error} />
          {file && (
            <button type="button" className="button button-primary button-small" onClick={() => attach.mutate()} disabled={attach.isPending}>
              Upload audio
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function EditBook({ book, onDone }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cover, setCover] = useState(null);
  const save = useBookMutation(book.id, (fields) => api(`/books/${book.id}`, { method: 'PATCH', body: fields }), {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.tags });
      onDone();
    },
  });
  const changeCover = useBookMutation(book.id, () => {
    const form = new FormData();
    form.append('cover', cover);
    return upload(`/books/${book.id}/cover`, form, { method: 'PUT' });
  }, { onSuccess: () => setCover(null) });
  const remove = useBookMutation(book.id, () => api(`/books/${book.id}`, { method: 'DELETE' }), {
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: keys.book(book.id) });
      navigate('/', { replace: true });
    },
  });

  const onSubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      title: form.get('title'),
      author: form.get('author'),
      description: form.get('description'),
      language: form.get('language'),
      tags: form.get('tags'),
    });
  };

  return (
    <section className="panel edit-panel">
      <h2 className="panel-title">
        <Pencil size={18} aria-hidden="true" /> Edit book
      </h2>
      <form className="form" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="field">
            <span>Title</span>
            <input name="title" defaultValue={book.title} required maxLength={300} />
          </label>
          <label className="field">
            <span>Author</span>
            <input name="author" defaultValue={book.author} maxLength={200} />
          </label>
          <label className="field">
            <span>Tags</span>
            <input name="tags" defaultValue={book.tags?.join(', ')} maxLength={500} />
          </label>
          <label className="field">
            <span>Language</span>
            <input name="language" defaultValue={book.language} maxLength={20} />
          </label>
        </div>
        <label className="field">
          <span>Description</span>
          <textarea name="description" rows={4} defaultValue={book.description} maxLength={5000} />
        </label>
        <ErrorMessage error={save.error} />
        <div className="button-row">
          <button className="button button-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="button button-ghost" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>

      <div className="field">
        <span>Cover</span>
        <FileDrop accept="image/jpeg,image/png,image/webp,image/gif" file={cover} onFile={setCover} icon={ImagePlus} label="Choose a new cover" hint="JPG, PNG, WEBP or GIF" />
        <ErrorMessage error={changeCover.error} />
        {cover && (
          <button type="button" className="button button-small" onClick={() => changeCover.mutate()} disabled={changeCover.isPending}>
            {changeCover.isPending ? 'Uploading…' : 'Use this cover'}
          </button>
        )}
      </div>

      <div className="danger-zone">
        <div>
          <strong>Delete this book</strong>
          <p className="muted small">Removes the file, narration, audiobook, and everyone's progress and bookmarks.</p>
        </div>
        <ErrorMessage error={remove.error} />
        <button
          type="button"
          className="button button-danger"
          disabled={remove.isPending}
          onClick={() => window.confirm(`Delete "${book.title}" for everyone? This can't be undone.`) && remove.mutate()}
        >
          <Trash2 size={16} aria-hidden="true" /> {remove.isPending ? 'Deleting…' : 'Delete book'}
        </button>
      </div>
    </section>
  );
}

