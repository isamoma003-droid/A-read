import { Crown, Headphones, Infinity as Forever, RefreshCcw, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useBooks, usePass } from '../api/queries.js';
import BookCard, { BookCardSkeleton } from '../components/BookCard.jsx';
import { ErrorMessage, PageLoader } from '../components/Feedback.jsx';
import PassCheckout from '../components/PassCheckout.jsx';
import { formatKes, formatNumber } from '../utils/format.js';
import { useCanonical } from '../utils/seo.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

const longDate = (date) => new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

// /premium: the Premium Pass, one payment that opens every premium book for a while.
export default function PremiumPage() {
  const { data: pass, isPending, error } = usePass();
  const books = useBooks({ access: 'premium', sort: 'rating', limit: 12 });
  const list = books.data?.pages[0]?.books ?? [];
  useDocumentTitle('Premium Pass', 'Read and listen to every premium book on A-Read with one M-Pesa payment.');
  useCanonical('/premium');

  if (isPending) return <PageLoader label="Loading…" />;
  if (error) return <ErrorMessage error={error} />;
  const all = pass.premiumBooks === 1 ? 'the premium book' : `all ${formatNumber(pass.premiumBooks)} premium books`;

  return (
    <div className="narrow-wide premium-page">
      <section className="hero premium-hero">
        <div className="hero-text">
          <p className="eyebrow">
            <Crown size={14} aria-hidden="true" /> A-Read Premium Pass
          </p>
          <h1>Every premium book, one payment.</h1>
          {pass.onSale ? (
            <p className="muted">
              Open {all} for {pass.days} days for {formatKes(pass.price)}: every chapter, read on screen or listened to, on all
              your devices.
            </p>
          ) : (
            <p className="muted">The Premium Pass isn&apos;t on sale right now. Premium books can still be unlocked one at a time.</p>
          )}
          {pass.active && <p className="premium-status">Your pass is active until {longDate(pass.activeUntil)}.</p>}
          {!pass.active && pass.activeUntil && <p className="muted small">Your last pass ended on {longDate(pass.activeUntil)}.</p>}
        </div>
      </section>

      {pass.onSale && (
        <div className="premium-columns">
          <section className="panel">
            <h2 className="panel-title">What you get</h2>
            <ul className="benefits">
              <li>
                <Crown size={18} aria-hidden="true" /> Every chapter of {all}, and any added while your pass lasts.
              </li>
              <li>
                <Headphones size={18} aria-hidden="true" /> Narration and audiobooks for each of them.
              </li>
              <li>
                <WifiOff size={18} aria-hidden="true" /> Books you open stay readable offline.
              </li>
              <li>
                <RefreshCcw size={18} aria-hidden="true" /> No automatic renewal. Buy again whenever you like and the days add on.
              </li>
              <li>
                <Forever size={18} aria-hidden="true" /> Books you unlocked on their own stay yours for good.
              </li>
            </ul>
          </section>
          <section className="panel">
            <h2 className="panel-title">{pass.active ? 'Add more time' : 'Get the pass'}</h2>
            <PassCheckout pass={pass} />
          </section>
        </div>
      )}

      <section>
        <div className="library-header">
          <h2 className="section-title">Premium books</h2>
          <Link to="/?access=premium" className="small">
            See all
          </Link>
        </div>
        {books.isSuccess && list.length === 0 && <p className="muted">No premium books yet.</p>}
        <div className="book-grid">
          {books.isPending && Array.from({ length: 4 }, (_, i) => <BookCardSkeleton key={i} />)}
          {list.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      </section>
    </div>
  );
}
