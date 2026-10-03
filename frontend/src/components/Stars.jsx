import { useState } from 'react';
import { Star } from 'lucide-react';

// A rating shown as five stars, filled to the nearest tenth.
export function Stars({ value, size = 16 }) {
  const stars = (filled) => Array.from({ length: 5 }, (_, i) => <Star key={i} size={size} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />);
  return (
    <span className="stars" role="img" aria-label={`${value} out of 5 stars`}>
      <span className="stars-empty">{stars(false)}</span>
      <span className="stars-fill" style={{ width: `${(Math.max(0, Math.min(5, value)) / 5) * 100}%` }}>
        {stars(true)}
      </span>
    </span>
  );
}

const LABELS = ['', 'Did not like it', 'It was OK', 'Liked it', 'Really liked it', 'Loved it'];

// Picks 1 to 5 stars.
export function StarInput({ value, onChange, size = 28 }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="star-input">
      <div role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? '' : 's'}: ${LABELS[n]}`}
            className={n <= shown ? 'on' : ''}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
          >
            <Star size={size} fill={n <= shown ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        ))}
      </div>
      <span className="muted small">{LABELS[shown] || 'Tap a star to rate'}</span>
    </div>
  );
}
