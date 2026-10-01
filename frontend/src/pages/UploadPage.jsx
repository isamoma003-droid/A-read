import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { upload } from '../api/client.js';
import { keys } from '../api/queries.js';
import FileDrop from '../components/FileDrop.jsx';
import { ErrorMessage, ProgressBar, Spinner } from '../components/Feedback.jsx';

const BOOK_TYPES = '.pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain';

export default function UploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [cover, setCover] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      setError(new Error('Choose a PDF, EPUB or TXT file first'));
      return;
    }
    const form = new FormData(event.currentTarget);
    form.append('file', file);
    if (cover) form.append('cover', cover);
    setError(null);
    setProgress(0);
    try {
      const { book } = await upload('/books', form, { onProgress: setProgress });
      queryClient.setQueryData(keys.book(book.id), book);
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: keys.tags });
      navigate(`/books/${book.id}`);
    } catch (err) {
      setError(err);
      setProgress(null);
    }
  };

  const busy = progress !== null;
  return (
    <div className="narrow">
      <h1 className="section-title">Upload a book</h1>
      <p className="muted">
        PDF, EPUB or TXT. The text is pulled out so the book can be read on screen and read aloud. Everyone in the library
        can see books you upload.
      </p>

      <form className="form upload-form" onSubmit={onSubmit}>
        <FileDrop
          accept={BOOK_TYPES}
          file={file}
          onFile={setFile}
          label="Drop your book here or click to browse"
          hint="PDF, EPUB or TXT"
        />

        <div className="form-grid">
          <label className="field">
            <span>Title</span>
            <input name="title" maxLength={300} placeholder="Taken from the file if left empty" disabled={busy} />
          </label>
          <label className="field">
            <span>Author</span>
            <input name="author" maxLength={200} placeholder="Taken from the file if left empty" disabled={busy} />
          </label>
          <label className="field">
            <span>Tags</span>
            <input name="tags" maxLength={500} placeholder="fiction, classic, history" disabled={busy} />
          </label>
          <label className="field">
            <span>Language</span>
            <input name="language" maxLength={20} placeholder="e.g. en, fr, es" disabled={busy} />
          </label>
        </div>
        <label className="field">
          <span>Description</span>
          <textarea name="description" rows={3} maxLength={5000} placeholder="Optional" disabled={busy} />
        </label>

        <div className="field">
          <span>Cover image (optional)</span>
          <FileDrop
            accept="image/jpeg,image/png,image/webp,image/gif"
            file={cover}
            onFile={setCover}
            icon={ImagePlus}
            label="Add a cover"
            hint="Without one, A-Read uses the PDF's first page, the EPUB's own cover, or a generated cover."
          />
        </div>

        <ErrorMessage error={error} />

        {busy && (
          <div className="upload-status">
            {progress < 1 ? (
              <>
                <span>Uploading… {Math.round(progress * 100)}%</span>
                <ProgressBar value={progress * 100} label="Upload progress" />
              </>
            ) : (
              <Spinner label="Processing the book: extracting text and chapters…" />
            )}
          </div>
        )}

        <button className="button button-primary" disabled={busy || !file}>
          {busy ? 'Working…' : 'Upload book'}
        </button>
      </form>
    </div>
  );
}
