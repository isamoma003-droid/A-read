import { useState } from 'react';
import { CheckCircle2, CloudDownload, LoaderCircle } from 'lucide-react';
import { downloadBook, offlineSupported, removeDownload, useDownloads } from '../offline/store.js';
import { useOnline } from '../offline/useOnline.js';
import { formatBytes } from '../utils/format.js';

// Saves a book (text, file, cover, narration, audiobook) on this device for offline use.
export default function DownloadButton({ book }) {
  const downloads = useDownloads();
  const online = useOnline();
  const saved = downloads[book.id];
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  if (!offlineSupported) return null;

  const start = async () => {
    setError(null);
    setProgress({ done: 0, total: 1 });
    try {
      await downloadBook(book, { onProgress: setProgress });
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  };

  if (progress) {
    return (
      <button type="button" className="button" disabled>
        <LoaderCircle size={16} className="spin" aria-hidden="true" /> Saving {Math.round((progress.done / progress.total) * 100)}%
      </button>
    );
  }

  if (saved) {
    return (
      <div className="download-state">
        <span className="download-saved" title={`Saved ${new Date(saved.savedAt).toLocaleString()}`}>
          <CheckCircle2 size={16} aria-hidden="true" /> Available offline · {formatBytes(saved.bytes)}
        </span>
        {online && (
          <button type="button" className="link-button small" onClick={start}>
            Update
          </button>
        )}
        <button
          type="button"
          className="link-button small"
          onClick={() => window.confirm('Remove the offline copy from this device?') && removeDownload(book.id)}
        >
          Remove
        </button>
      </div>
    );
  }

  const size = (book.file?.bytes || 0) + (book.audiobook?.bytes || 0);
  return (
    <>
      <button type="button" className="button" onClick={start} disabled={!online} title="Save this book on this device to read and listen offline">
        <CloudDownload size={16} aria-hidden="true" /> Download{size ? ` (${formatBytes(size)}${book.narration?.status === 'ready' ? ' + narration' : ''})` : ''}
      </button>
      {error && <span className="error-inline">{error}</span>}
    </>
  );
}
