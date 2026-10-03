import { useState } from 'react';
import { BookCheck, MessageSquare, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, useReviews } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { timeAgo } from '../utils/format.js';
import { isAdmin } from '../utils/roles.js';
import { ErrorMessage, Spinner } from './Feedback.jsx';
import { StarInput, Stars } from './Stars.jsx';

// Ratings and reviews on a book's page: the summary, the reader's own review, and everyone's.
export default function ReviewsPanel({ book }) {
  const { user } = useAuth();
  const reviews = useReviews(book.id);
  const first = reviews.data?.pages[0];
  const list = reviews.data?.pages.flatMap((page) => page.reviews) ?? [];
  const queryClient = useQueryClient();
  const [error, setError] = useState(null);

  // A change to any review moves the book's stars everywhere it's shown.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: keys.reviews(book.id) });
    queryClient.invalidateQueries({ queryKey: keys.book(book.id) });
    queryClient.invalidateQueries({ queryKey: ['books'] });
  };

  const remove = async (review) => {
    if (!window.confirm(`Remove ${review.user.name}'s review?`)) return;
    setError(null);
    try {
      await api(`/books/${book.id}/reviews/${review.id}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <section className="panel reviews" id="reviews">
      <h2 className="panel-title">
        <MessageSquare size={18} aria-hidden="true" /> Ratings and reviews
      </h2>
      {reviews.isPending && <Spinner label="Loading reviews…" />}
      <ErrorMessage error={reviews.error || error} />
      {first && (
        <div className="reviews-layout">
          <div className="stack">
            <RatingSummary summary={first.summary} />
            {user ? (
              first.canReview ? (
                <MyReview key={first.mine?.updatedAt ?? 'new'} book={book} mine={first.mine} onSaved={refresh} />
              ) : (
                <p className="muted small">You uploaded this book, so the rating is up to its readers.</p>
              )
            ) : (
              <p className="muted small">
                <Link to="/login" state={{ from: `/books/${book.id}` }}>
                  Sign in
                </Link>{' '}
                to rate this book and say what you thought.
              </p>
            )}
          </div>
          <div className="review-list">
            {list.length === 0 && <p className="muted">No written reviews yet{first.summary.count ? '' : '. Be the first to say what you thought'}.</p>}
            {list.map((review) => (
              <article key={review.id} className="review">
                <header className="review-header">
                  <span className="user-chip" aria-hidden="true">
                    {review.user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{review.mine ? 'You' : review.user.name}</strong>
                    <div className="review-meta">
                      <Stars value={review.rating} size={14} />
                      <span className="muted small">{timeAgo(review.updatedAt)}</span>
                      {review.finished && (
                        <span className="badge badge-accent" title="Read to the end on A-Read">
                          <BookCheck size={12} aria-hidden="true" /> Finished it
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin(user) && !review.mine && (
                    <button type="button" className="icon-button danger" onClick={() => remove(review)} title="Remove review">
                      <Trash2 size={16} />
                      <span className="sr-only">Remove {review.user.name}&apos;s review</span>
                    </button>
                  )}
                </header>
                <p className="review-text">{review.text}</p>
              </article>
            ))}
            {reviews.hasNextPage && (
              <button type="button" className="button button-small" onClick={() => reviews.fetchNextPage()} disabled={reviews.isFetchingNextPage}>
                {reviews.isFetchingNextPage ? <Spinner label="Loading…" /> : 'More reviews'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function RatingSummary({ summary }) {
  if (!summary.count) return <p className="muted">No ratings yet.</p>;
  const most = Math.max(...Object.values(summary.distribution));
  return (
    <div className="rating-summary">
      <div className="rating-big">
        <strong>{summary.average.toFixed(1)}</strong>
        <Stars value={summary.average} size={18} />
        <span className="muted small">{summary.count === 1 ? '1 rating' : `${summary.count} ratings`}</span>
      </div>
      <ul className="rating-bars" aria-label="Ratings by stars">
        {[5, 4, 3, 2, 1].map((n) => (
          <li key={n}>
            <span className="small">{n}★</span>
            <span className="rating-bar">
              <span style={{ width: `${most ? (summary.distribution[n] / most) * 100 : 0}%` }} />
            </span>
            <span className="muted small">{summary.distribution[n]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MyReview({ book, mine, onSaved }) {
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [text, setText] = useState(mine?.text ?? '');
  const [editing, setEditing] = useState(!mine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (request) => {
    setBusy(true);
    setError(null);
    try {
      await request();
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const save = (event) => {
    event.preventDefault();
    run(() => api(`/books/${book.id}/reviews/mine`, { method: 'PUT', body: { rating, text } }));
  };
  const remove = () => window.confirm('Remove your rating and review?') && run(() => api(`/books/${book.id}/reviews/mine`, { method: 'DELETE' }));

  if (mine && !editing) {
    return (
      <div className="my-review">
        <span className="muted small">Your rating</span>
        <Stars value={mine.rating} size={18} />
        {mine.text && <p className="review-text">{mine.text}</p>}
        <div className="button-row">
          <button type="button" className="button button-small" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="button button-ghost button-small" onClick={remove} disabled={busy}>
            Remove
          </button>
        </div>
        <ErrorMessage error={error} />
      </div>
    );
  }

  return (
    <form className="form my-review" onSubmit={save}>
      <span className="muted small">{mine ? 'Change your rating' : 'Rate this book'}</span>
      <StarInput value={rating} onChange={setRating} />
      <label className="field">
        <span>Your review (optional)</span>
        <textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you think? No spoilers, please." />
      </label>
      <ErrorMessage error={error} />
      <div className="button-row">
        <button className="button button-primary button-small" disabled={!rating || busy}>
          {busy ? 'Saving…' : mine ? 'Save' : 'Post'}
        </button>
        {mine && (
          <button type="button" className="button button-ghost button-small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
