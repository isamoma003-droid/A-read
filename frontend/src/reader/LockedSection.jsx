import { Crown } from 'lucide-react';
import UnlockBook from '../components/UnlockBook.jsx';
import { formatKes, formatNumber, partName } from '../utils/format.js';

// Shown in place of a premium chapter's text until the reader unlocks the book.
export default function LockedSection({ book, sections }) {
  const locked = sections.filter((s) => s.locked).length;
  return (
    <div className="locked-section">
      <span className="locked-icon">
        <Crown size={26} aria-hidden="true" />
      </span>
      <h3>This {partName(book.format)} is part of the premium edition</h3>
      <p className="muted">
        Pay {formatKes(book.premium.price)} once to unlock {locked === 1 ? 'it' : `all ${formatNumber(locked)} locked ${partName(book.format, locked)}`} of “
        {book.title}”, to read and listen to on every device.
      </p>
      <UnlockBook book={book} />
    </div>
  );
}
