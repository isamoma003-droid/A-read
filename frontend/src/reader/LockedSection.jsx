import { Crown } from 'lucide-react';
import UnlockBook from '../components/UnlockBook.jsx';
import { formatKes, formatNumber, partName } from '../utils/format.js';

// Shown in place of a premium chapter's text until the reader unlocks the book. `price` comes from
// the book, or from the server's 402 answer when the chapter was locked after the book loaded.
export default function LockedSection({ book, sections, price }) {
  const locked = Math.max(1, sections.filter((s) => s.locked).length);
  return (
    <div className="locked-section">
      <span className="locked-icon">
        <Crown size={26} aria-hidden="true" />
      </span>
      <h3>This {partName(book.format)} is part of the premium edition</h3>
      <p className="muted">
        {price ? `Pay ${formatKes(price)} once to unlock` : 'Unlock'}{' '}
        {locked === 1 ? 'it' : `all ${formatNumber(locked)} locked ${partName(book.format, locked)}`} of “{book.title}”, to read and listen to on
        every device.
      </p>
      <UnlockBook book={book} price={price} />
    </div>
  );
}
