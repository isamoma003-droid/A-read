import { CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { markSeen, useUploads } from '../uploads/store.js';
import { ProgressBar } from './Feedback.jsx';

// A small card in the corner of every page (except the upload page itself) while books upload in
// the background, and once they're done, until the reader looks or closes it.
export default function UploadDock() {
  const { pathname } = useLocation();
  const { items, running, unseen } = useUploads();
  if (pathname === '/upload' || !items.length || (!running && !unseen)) return null;

  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error' || i.status === 'missing').length;
  const current = items.find((i) => ['preparing', 'uploading', 'processing'].includes(i.status));
  const total = items.length;
  // Finished books count whole; the one being sent counts by how much of it has gone.
  const sent = current?.status === 'processing' ? 1 : current?.status === 'uploading' ? current.progress : 0;
  const percent = ((done + sent) / total) * 100;

  return (
    <aside className="upload-dock" aria-live="polite">
      <span className="upload-dock-icon">
        {running ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : failed ? <CircleAlert size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
      </span>
      <div className="upload-dock-body">
        <strong>
          {running
            ? `Uploading ${Math.min(done + 1, total)} of ${total}`
            : done
              ? `${done === 1 ? '1 book' : `${done} books`} added to the library`
              : 'Uploads stopped'}
        </strong>
        {running && current && <span className="muted small upload-dock-name">{current.name}</span>}
        {!running && failed > 0 && <span className="muted small">{failed === 1 ? '1 upload needs attention' : `${failed} uploads need attention`}</span>}
        {running && <ProgressBar value={percent} label="Upload progress" />}
      </div>
      <Link to="/upload" className="button button-small">
        {running ? 'View' : 'Open'}
      </Link>
      {!running && (
        <button type="button" className="icon-button" onClick={markSeen} title="Close">
          <X size={16} />
          <span className="sr-only">Close</span>
        </button>
      )}
    </aside>
  );
}
