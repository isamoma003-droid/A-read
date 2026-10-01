import { Headphones } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FORMAT_LABELS } from '../utils/format.js';
import BookCover from './BookCover.jsx';
import { ProgressBar } from './Feedback.jsx';

export default function BookCard({ book, percent }) {
  const progress = percent ?? book.progress?.percent;
  const hasAudio = book.hasAudio ?? (Boolean(book.audiobook?.url) || ['ready', 'partial'].includes(book.narration?.status));
  return (
    <Link to={`/books/${book.id}`} className="book-card">
      <BookCover book={book} />
      <div className="book-card-body">
        <h3 className="book-card-title">{book.title}</h3>
        {book.author && <p className="book-card-author">{book.author}</p>}
        <div className="book-card-meta">
          <span className="badge">{FORMAT_LABELS[book.format]}</span>
          {hasAudio && (
            <span className="badge badge-accent" title="Has narration or an audiobook">
              <Headphones size={12} aria-hidden="true" /> Audio
            </span>
          )}
        </div>
        {progress > 0 && <ProgressBar value={progress} label={`${Math.round(progress)}% read`} />}
      </div>
    </Link>
  );
}
