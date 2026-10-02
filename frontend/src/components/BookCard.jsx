import { BookOpen, Crown, Headphones } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FORMAT_LABELS, formatKes } from '../utils/format.js';
import BookCover from './BookCover.jsx';
import { ProgressBar } from './Feedback.jsx';

export default function BookCard({ book, percent }) {
  const progress = percent ?? book.progress?.percent;
  const hasAudio = book.hasAudio ?? (Boolean(book.audiobook?.url) || ['ready', 'partial'].includes(book.narration?.status));
  return (
    <Link to={`/books/${book.id}`} className="book-card">
      <div className="book-card-cover">
        <BookCover book={book} />
        <span className="book-card-overlay" aria-hidden="true">
          <span className="overlay-pill">
            <BookOpen size={15} /> {progress > 0 ? 'Continue' : 'Open'}
          </span>
        </span>
        {hasAudio && (
          <span className="cover-flag" title="Has narration or an audiobook">
            <Headphones size={13} aria-hidden="true" />
            <span className="sr-only">Has audio</span>
          </span>
        )}
        {book.premium && (
          <span className="cover-flag cover-flag-premium" title={book.unlocked ? 'Premium: unlocked' : 'Premium: some chapters are locked'}>
            <Crown size={13} aria-hidden="true" />
            <span className="sr-only">Premium</span>
          </span>
        )}
      </div>
      <div className="book-card-body">
        <h3 className="book-card-title">{book.title}</h3>
        {book.author && <p className="book-card-author">{book.author}</p>}
        <div className="book-card-meta">
          <span className="badge">{FORMAT_LABELS[book.format]}</span>
          {book.premium && !book.unlocked && <span className="badge badge-premium">{formatKes(book.premium.price)}</span>}
          {progress > 0 && <span className="muted small">{Math.round(progress)}%</span>}
        </div>
        {progress > 0 && <ProgressBar value={progress} label={`${Math.round(progress)}% read`} />}
      </div>
    </Link>
  );
}

export function BookCardSkeleton() {
  return (
    <div className="book-card skeleton-card" aria-hidden="true">
      <div className="cover skeleton" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line short" />
    </div>
  );
}
