import { useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, FileText, ImagePlus, LoaderCircle, Plus, UploadCloud, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { upload } from '../api/client.js';
import { keys, useCategories, useSystemConfig } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdmin } from '../utils/roles.js';
import CategorySelect from '../components/CategorySelect.jsx';
import FileDrop from '../components/FileDrop.jsx';
import { ErrorMessage, ProgressBar } from '../components/Feedback.jsx';
import { formatBytes } from '../utils/format.js';
import { pdfCoverFromFile } from '../utils/pdfCover.js';

const BOOK_TYPES = '.pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain';
const MAX_MB = Number(import.meta.env.VITE_MAX_BOOK_MB || 100);
const MAX_FILES = 20;
const extension = (name) => name.slice(name.lastIndexOf('.')).toLowerCase();

let nextId = 0;

export default function UploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const input = useRef(null);
  const [items, setItems] = useState([]);
  const [cover, setCover] = useState(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const { data: categories } = useCategories();
  const { user } = useAuth();
  const { data: system } = useSystemConfig();

  const single = items.length === 1;
  const finished = items.length > 0 && items.every((i) => i.status === 'done');
  const patch = (id, change) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...change } : i)));

  const addFiles = (fileList) => {
    setError(null);
    const accepted = [];
    const rejected = [];
    for (const file of fileList) {
      if (!['.pdf', '.epub', '.txt'].includes(extension(file.name))) rejected.push(`${file.name} (not PDF/EPUB/TXT)`);
      else if (file.size > MAX_MB * 1024 * 1024) rejected.push(`${file.name} (over ${MAX_MB} MB)`);
      else accepted.push({ id: ++nextId, file, status: 'queued', progress: 0 });
    }
    setItems((list) => {
      const fresh = list.filter((i) => i.status !== 'done');
      return [...fresh, ...accepted].slice(0, MAX_FILES);
    });
    if (rejected.length) setError(new Error(`Skipped: ${rejected.join(', ')}`));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    const queue = items.filter((i) => i.status === 'queued' || i.status === 'error');
    if (!queue.length) return;
    const shared = new FormData(event.currentTarget);
    setRunning(true);
    setError(null);
    const created = [];

    for (const item of queue) {
      const form = new FormData();
      for (const key of ['tags', 'language', 'description', 'category']) {
        if (shared.get(key)) form.append(key, shared.get(key));
      }
      if (single) {
        for (const key of ['title', 'author']) if (shared.get(key)) form.append(key, shared.get(key));
      }
      form.append('file', item.file);
      let coverFile = single ? cover : null;
      if (!coverFile && extension(item.file.name) === '.pdf') {
        patch(item.id, { status: 'preparing' });
        coverFile = await pdfCoverFromFile(item.file);
      }
      if (coverFile) form.append('cover', coverFile);

      patch(item.id, { status: 'uploading', progress: 0, error: null });
      try {
        const { book } = await upload('/books', form, {
          onProgress: (p) => patch(item.id, { progress: p, status: p >= 1 ? 'processing' : 'uploading' }),
        });
        queryClient.setQueryData(keys.book(book.id), book);
        patch(item.id, { status: 'done', book });
        created.push(book);
      } catch (err) {
        patch(item.id, { status: 'error', error: err.message });
      }
    }

    setRunning(false);
    queryClient.invalidateQueries({ queryKey: ['books'] });
    queryClient.invalidateQueries({ queryKey: keys.tags });
    queryClient.invalidateQueries({ queryKey: keys.categories });
    if (single && created.length === 1) navigate(`/books/${created[0].id}`);
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

  return (
    <div className="narrow">
      <header className="page-header">
        <h1 className="section-title">Upload books</h1>
        <p className="muted">
          PDF, EPUB or TXT, up to {MAX_MB} MB each, and up to {MAX_FILES} at a time. A-Read pulls out the text so every book can be
          read on screen and read aloud. Everyone in the library can see your uploads.
        </p>
      </header>

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
            if (!running) addFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={input}
            type="file"
            accept={BOOK_TYPES}
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
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
                  ) : item.status === 'error' ? (
                    <CircleAlert size={20} />
                  ) : ['uploading', 'processing', 'preparing'].includes(item.status) ? (
                    <LoaderCircle size={20} className="spin" />
                  ) : (
                    <FileText size={20} />
                  )}
                </span>
                <div className="upload-item-body">
                  <div className="upload-item-name">
                    {item.book ? <Link to={`/books/${item.book.id}`}>{item.book.title}</Link> : item.file.name}
                  </div>
                  <div className="muted small">
                    {formatBytes(item.file.size)} ·{' '}
                    {
                      {
                        queued: 'Ready to upload',
                        preparing: 'Making a cover…',
                        uploading: `Uploading ${Math.round(item.progress * 100)}%`,
                        processing: 'Extracting text and chapters…',
                        done: 'Added to the library',
                        error: item.error,
                      }[item.status]
                    }
                  </div>
                  {item.status === 'uploading' && <ProgressBar value={item.progress * 100} label={`Uploading ${item.file.name}`} />}
                </div>
                {!running && item.status !== 'done' && (
                  <button
                    type="button"
                    className="icon-button"
                    title="Remove"
                    onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))}
                  >
                    <X size={16} />
                    <span className="sr-only">Remove {item.file.name}</span>
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
                <input name="title" maxLength={300} placeholder="Taken from the file if left empty" />
              </label>
              <label className="field">
                <span>Author</span>
                <input name="author" maxLength={200} placeholder="Taken from the file if left empty" />
              </label>
            </div>
          ) : (
            items.length > 1 && <p className="muted small">Titles and authors are read from each file. You can edit them afterwards.</p>
          )}
          <div className="form-grid">
            {categories?.length > 0 && (
              <label className="field">
                <span>Category</span>
                <CategorySelect categories={categories} />
              </label>
            )}
            <label className="field">
              <span>Tags</span>
              <input name="tags" maxLength={500} placeholder="fiction, classic, history" />
            </label>
            <label className="field">
              <span>Language</span>
              <input name="language" maxLength={20} placeholder="e.g. en, fr, sw" />
            </label>
          </div>
          {single && (
            <>
              <label className="field">
                <span>Description</span>
                <textarea name="description" rows={3} maxLength={5000} placeholder="Optional" />
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
              <button type="button" className="button" onClick={() => setItems([])}>
                <Plus size={16} aria-hidden="true" /> Upload more
              </button>
            </>
          ) : (
            <button className="button button-primary" disabled={running || !items.some((i) => i.status === 'queued' || i.status === 'error')}>
              {running ? 'Uploading…' : items.length > 1 ? `Upload ${items.filter((i) => i.status !== 'done').length} books` : 'Upload book'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
