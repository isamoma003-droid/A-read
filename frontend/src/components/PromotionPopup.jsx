import { useEffect, useRef, useState } from 'react';
import { Heart, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useActivePromotion } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatKes } from '../utils/format.js';

// Promotions closed during this page load (frequency "visit" shows again on the next one).
const closedThisLoad = new Set();

const storage = (kind) => {
  try {
    return kind === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
};

const today = () => new Date().toLocaleDateString('en-CA');

// Editing a promotion (new updatedAt) counts as a new one, so readers see the change.
const seenKey = (p) => `a-read-promo-${p.id}-${new Date(p.updatedAt).getTime()}`;

function alreadySeen(p) {
  if (closedThisLoad.has(seenKey(p))) return true;
  try {
    if (p.frequency === 'session') return Boolean(storage('session')?.getItem(seenKey(p)));
    if (p.frequency === 'day') return storage('local')?.getItem(seenKey(p)) === today();
    if (p.frequency === 'once') return Boolean(storage('local')?.getItem(seenKey(p)));
  } catch {
    // Storage blocked: fall back to once per page load.
  }
  return false;
}

function markSeen(p) {
  closedThisLoad.add(seenKey(p));
  try {
    if (p.frequency === 'session') storage('session')?.setItem(seenKey(p), '1');
    if (p.frequency === 'day') storage('local')?.setItem(seenKey(p), today());
    if (p.frequency === 'once') storage('local')?.setItem(seenKey(p), '1');
  } catch {
    // ignore
  }
}

export const supportLink = (promotion, amount) => {
  const params = new URLSearchParams();
  if (promotion?.id) params.set('promo', promotion.id);
  if (amount) params.set('amount', String(amount));
  const query = params.toString();
  return `/support${query ? `?${query}` : ''}`;
};

// The card itself. Also used as the live preview in the admin form.
export function PromotionCard({ promotion, onClose, countdown, paused, preview = false }) {
  const titleId = `promo-title-${promotion.id || 'preview'}`;
  const go = preview ? (e) => e.preventDefault() : onClose;
  return (
    <div className={`promo-card ${preview ? 'promo-preview' : ''}`} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <button type="button" className="icon-button promo-close" onClick={onClose} title="Close">
        <X size={18} />
        <span className="sr-only">Close</span>
      </button>
      <span className="promo-icon" aria-hidden="true">
        <Heart size={20} />
      </span>
      <h2 id={titleId} className="promo-title">
        {promotion.title || 'Popup title'}
      </h2>
      {promotion.message && <p className="promo-message">{promotion.message}</p>}
      {promotion.amounts?.length > 0 && (
        <div className="promo-amounts">
          {promotion.amounts.map((amount) => (
            <Link key={amount} to={supportLink(promotion, amount)} className="chip" onClick={go}>
              {formatKes(amount)}
            </Link>
          ))}
        </div>
      )}
      <div className="button-row">
        <Link to={supportLink(promotion)} className="button button-primary" onClick={go}>
          <Heart size={16} aria-hidden="true" /> {promotion.buttonLabel || 'Support us'}
        </Link>
        <button type="button" className="button button-ghost" onClick={onClose}>
          Not now
        </button>
      </div>
      <p className="muted small promo-footnote">Paid securely with M-Pesa. Reading stays free either way.</p>
      {countdown > 0 && <span className={`promo-timer ${paused ? 'paused' : ''}`} style={{ animationDuration: `${countdown}s` }} aria-hidden="true" />}
    </div>
  );
}

// Shows the admin's current promotion in a corner of the page. It never covers the page or
// takes focus, so readers can ignore it and keep browsing.
export default function PromotionPopup() {
  const { user } = useAuth();
  const location = useLocation();
  const { data: promotion } = useActivePromotion(user?.id || 'guest');
  const [shown, setShown] = useState(null);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(0);
  const onSupportPage = location.pathname === '/support';

  // Wait the configured delay, then show it (unless this reader has already seen it).
  useEffect(() => {
    if (!promotion || onSupportPage || shown?.id === promotion.id || alreadySeen(promotion)) return undefined;
    const timer = setTimeout(() => {
      markSeen(promotion);
      remaining.current = promotion.autoCloseSeconds * 1000;
      setShown(promotion);
    }, promotion.delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [promotion, onSupportPage, shown]);

  // Hide it if the admin pauses or ends it, or the reader opens the support page.
  const visible = shown && promotion?.id === shown.id && !onSupportPage;

  // Auto-close, paused while the pointer or keyboard focus is on the card.
  useEffect(() => {
    if (!visible || !shown.autoCloseSeconds || paused) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => setShown(null), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [visible, shown, paused]);

  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => e.key === 'Escape' && setShown(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      className="promo-popup"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <PromotionCard promotion={shown} onClose={() => setShown(null)} countdown={shown.autoCloseSeconds} paused={paused} />
    </div>
  );
}
