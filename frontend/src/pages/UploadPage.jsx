import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, FileText, ImagePlus, LoaderCircle, Plus, RotateCcw, UploadCloud, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useCategories, useSystemConfig } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdmin } from '../utils/roles.js';
import CategorySelect from '../components/CategorySelect.jsx';
import FileDrop from '../components/FileDrop.jsx';
import { ErrorMessage, ProgressBar } from '../components/Feedback.jsx';
import { formatBytes } from '../utils/format.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';
import {
  ACTIVE,
  BOOK_TYPES,
  MAX_FILES,
  MAX_MB,
  addFiles,
  clearFinished,
  markSeen,
  removeItem,
  setCover,
  startUploads,
  updateDraft,
  useUploads,
} from '../uploads/store.js';

function statusText(item) {
  return {
    queued: item.interrupted ? 'Waiting to carry on' : 'Ready to upload',
    preparing: 'Making a cover…',
    uploading: `Uploading ${Math.round(item.progress * 100)}%`,
    processing: 'Extracting text and chapters…',
    done: 'Added to the library',
    error: item.error,
    missing: 'Choose this file again to carry on (the browser could not keep it)',
  }[item.status];
}

export default function UploadPage() {
  const navigate = useNavigate();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState(null);
  const { items, draft, cover, running, elsewhere, restored, batch, lastBatch } = useUploads();
  const { data: categories } = useCategories();
  const { user } = useAuth();
  const { data: system } = useSystemConfig();
  useDocumentTitle('Upload books');

  // A single book that finishes while this page is open opens straight away.
  const batchAtOpen = useRef(batch);
  useEffect(() => {
    markSeen();
    if (batch === batchAtOpen.current) return;
    batchAtOpen.current = batch;
    if (lastBatch?.single && lastBatch.books.length === 1) navigate(`/books/${lastBatch.books[0]}`);
  }, [batch, lastBatch, navigate]);

  const single = items.length === 1;
  const finished = items.length > 0 && items.every((i) => i.status === 'done');
  const waiting = items.filter((i) => i.status === 'queued' || i.status === 'error');
  const missing = items.filter((i) => i.status === 'missing').length;

  const add = (fileList) => {
    setError(null);
    const rejected = addFiles(fileList);
    if (rejected.length) setError(new Error(`Skipped: ${rejected.join(', ')}`));
  };

  const onSubmit = (event) => {
    event.preventDefault();
    setError(null);
    startUploads();
  };

  if (system?.uploads === 'admins' && !isAdmin(user)) {
    return (
      <div className="narrow">
        <header className="page-header">
          <h1 className="section-title">Upload books</h1>
        </header>
        <p className="notice">Only admins can add books to the library right now.</p>
        <Link to="/">Back to the library</Link>
      </div>
    );
  }

  const field = (name) => ({ name, value: draft[name], onChange: (e) => updateDraft({ [name]: e.target.value }) });

  return (
    <div className="narrow">
      <header className="page-header">
        <h1 className="section-title">Upload books</h1>
        <p className="muted">
          PDF, EPUB or TXT, up to {MAX_MB} MB each, and up to {MAX_FILES} at a time. A-Read pulls out the text so every book can be
          read on screen and read aloud. Everyone in the library can see your uploads.
        </p>
        <p className="muted small">
          You can keep browsing while books upload. If the page reloads or you close it, your uploads carry on from where they
          stopped next time you open A-Read.
        </p>
      </header>

      {elsewhere && <p className="notice">These uploads are running in another A-Read tab or window. Check that one for progress.</p>}
      {restored && !elsewhere && (
        <p className="notice">
          <RotateCcw size={16} aria-hidden="true" /> We kept your uploads when the page closed.{' '}
          {running ? 'They are carrying on now.' : waiting.length ? 'Press Upload to carry on.' : ''}
        </p>
      )}
      {missing > 0 && (
        <p className="notice">
          {missing === 1 ? 'One file' : `${missing} files`} could not be kept by your browser while the page was closed. Drop{' '}
          {missing === 1 ? 'it' : 'them'} here again to carry on; nothing else needs redoing.
        </p>
      )}

      <form className="form upload-form" onSubmit={onSubmit}>
        <div
          className={`drop drop-large ${over ? 'drop-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!running) add(e.dataTransfer.files);
          }}
        >
          <input
            ref={input}
            type="file"
            accept={BOOK_TYPES}
            multiple
            hidden
            onChange={(e) => {
              add(e.target.files);
              e.target.value = '';
            }}
          />
          <button type="button" className="drop-button" onClick={() => input.current?.click()} disabled={running}>
            <span className="drop-icon">
              <UploadCloud size={30} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <strong>{items.length ? 'Add more books' : 'Drop books here or click to browse'}</strong>
            <span className="muted">PDF · EPUB · TXT — select several files at once</span>
          </button>
        </div>

        {items.length > 0 && (
          <ul className="upload-queue">
            {items.map((item) => (
              <li key={item.id} className={`upload-item upload-${item.status}`}>
                <span className="upload-item-icon">
                  {item.status === 'done' ? (
                    <CheckCircle2 size={20} />
                  ) : item.status === 'error' || item.status === 'missing' ? (
                    <CircleAlert size={20} />
                  ) : ACTIVE.includes(item.status) ? (
                    <LoaderCircle size={20} className="spin" />
                  ) : (
                    <FileText size={20} />
                  )}
                </span>
                <div className="upload-item-body">
                  <div className="upload-item-name">
                    {item.book ? <Link to={`/books/${item.book.id}`}>{item.book.title}</Link> : item.name}
                  </div>
                  <div className="muted small">
                    {formatBytes(item.size)} · {statusText(item)}
                  </div>
                  {item.status === 'uploading' && <ProgressBar value={item.progress * 100} label={`Uploading ${item.name}`} />}
                </div>
                {item.status !== 'done' && item.status !== 'processing' && (
                  <button
                    type="button"
                    className="icon-button"
                    title={ACTIVE.includes(item.status) ? 'Cancel this upload' : 'Remove'}
                    onClick={() => removeItem(item.id)}
                  >
                    <X size={16} />
                    <span className="sr-only">
                      {ACTIVE.includes(item.status) ? 'Cancel' : 'Remove'} {item.name}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <fieldset className="form-section" disabled={running}>
          <legend>{single ? 'Book details' : 'Details for every book in this batch'}</legend>
          {single ? (
            <div className="form-grid">
              <label className="field">
                <span>Title</span>
                <input {...field('title')} maxLength={300} placeholder="Taken from the file if left empty" />
              </label>
              <label className="field">
                <span>Author</span>
                <input {...field('author')} maxLength={200} placeholder="Taken from the file if left empty" />
              </label>
            </div>
          ) : (
            items.length > 1 && <p className="muted small">Titles and authors are read from each file. You can edit them afterwards.</p>
          )}
          <div className="form-grid">
            {categories?.length > 0 && (
              <label className="field">
                <span>Category</span>
                <CategorySelect
                  categories={categories}
                  emptyLabel="Choose automatically"
                  value={draft.category}
                  onChange={(category) => updateDraft({ category })}
                />
                <small className="muted">Left on automatic, A-Read picks one from the book when it&apos;s confident.</small>
              </label>
            )}
            <label className="field">
              <span>Tags</span>
              <input {...field('tags')} maxLength={500} placeholder="fiction, classic, history" />
            </label>
            <label className="field">
              <span>Language</span>
              <input {...field('language')} maxLength={20} placeholder="e.g. en, fr, sw" />
            </label>
          </div>
          {single && (
            <>
              <label className="field">
                <span>Description</span>
                <textarea {...field('description')} rows={3} maxLength={5000} placeholder="Optional" />
              </label>
              <div className="field">
                <span>Cover image (optional)</span>
                <FileDrop
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  file={cover}
                  onFile={setCover}
                  icon={ImagePlus}
                  label="Add a cover"
                  hint="Otherwise A-Read uses the PDF's first page, the EPUB's own cover, or draws one."
                />
              </div>
            </>
          )}
        </fieldset>

        <ErrorMessage error={error} />

        <div className="button-row">
          {finished && !running ? (
            <>
              <Link to="/" className="button button-primary">
                Go to the library
              </Link>
              <button type="button" className="button" onClick={clearFinished}>
                <Plus size={16} aria-hidden="true" /> Upload more
              </button>
            </>
          ) : (
            <button className="button button-primary" disabled={running || !waiting.length}>
              {running ? 'Uploading…' : waiting.length > 1 ? `Upload ${waiting.length} books` : 'Upload book'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
