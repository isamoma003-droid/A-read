import { Headphones } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useOfflineBooks } from '../offline/store.js';
import { FORMAT_LABELS } from '../utils/format.js';
import BookCover from './BookCover.jsx';

// Recently opened books that the app has kept for offline reading.
export default function OfflineBooks() {
  const books = Object.values(useOfflineBooks()).sort((a, b) => (b.openedAt || b.savedAt).localeCompare(a.openedAt || a.savedAt));
  if (!books.length) {
    return <p className="muted small">No books yet. Books you open while online stay readable here when you're offline.</p>;
  }
  return (
    <ul className="download-list">
      {books.map((b) => (
        <li key={b.id} className="download-item">
          <Link to={`/read/${b.id}`} className="table-book">
            <BookCover book={b} size="tiny" />
            <div>
              <strong>{b.title}</strong>
              <div className="muted small">
                {[b.author, FORMAT_LABELS[b.format]].filter(Boolean).join(' · ')}
                {(b.hasNarration || b.hasAudiobook) && (
                  <>
                    {' · '}
                    <Headphones size={12} aria-hidden="true" /> {b.hasNarration ? 'narration' : 'audiobook'}
                  </>
                )}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
