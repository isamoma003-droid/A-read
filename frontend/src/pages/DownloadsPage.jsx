import { useEffect, useState } from 'react';
import { CloudDownload, Headphones, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import BookCover from '../components/BookCover.jsx';
import { EmptyState } from '../components/Feedback.jsx';
import { removeDownload, storageEstimate, useDownloads } from '../offline/store.js';
import { FORMAT_LABELS, formatBytes, timeAgo } from '../utils/format.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

export function DownloadedList({ compact = false }) {
  const downloads = Object.values(useDownloads()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  if (!downloads.length) return null;
  return (
    <ul className="download-list">
      {downloads.map((d) => (
        <li key={d.id} className="download-item">
          <Link to={`/read/${d.id}`} className="table-book">
            <BookCover book={d} size="tiny" />
            <div>
              <strong>{d.title}</strong>
              <div className="muted small">
                {[d.author, FORMAT_LABELS[d.format], formatBytes(d.bytes)].filter(Boolean).join(' · ')}
                {(d.hasNarration || d.hasAudiobook) && (
                  <>
                    {' · '}
                    <Headphones size={12} aria-hidden="true" /> {d.hasNarration ? 'narration' : ''}
                    {d.hasNarration && d.hasAudiobook ? ' + ' : ''}
                    {d.hasAudiobook ? 'audiobook' : ''}
                  </>
                )}
              </div>
            </div>
          </Link>
          {!compact && (
            <>
              <span className="muted small hide-mobile">saved {timeAgo(d.savedAt)}</span>
              <button
                type="button"
                className="icon-button danger"
                title="Remove from this device"
                onClick={() => window.confirm(`Remove the offline copy of "${d.title}"?`) && removeDownload(d.id)}
              >
                <Trash2 size={16} />
                <span className="sr-only">Remove {d.title}</span>
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function DownloadsPage() {
  const downloads = useDownloads();
  const [estimate, setEstimate] = useState(null);
  useDocumentTitle('Downloads');

  useEffect(() => {
    storageEstimate().then(setEstimate);
  }, [downloads]);

  const empty = Object.keys(downloads).length === 0;
  return (
    <div className="narrow">
      <header className="page-header">
        <h1 className="section-title">Downloads</h1>
        <p className="muted">
          Books saved on this device. You can read them, listen to their narration or audiobook, and your progress syncs when
          you're back online.
          {estimate?.quota ? ` Using ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} available.` : ''}
        </p>
      </header>
      {empty ? (
        <EmptyState icon={CloudDownload} title="Nothing downloaded yet">
          Open a book and tap <strong>Download</strong> to keep it on this device.
        </EmptyState>
      ) : (
        <section className="panel">
          <DownloadedList />
        </section>
      )}
    </div>
  );
}
