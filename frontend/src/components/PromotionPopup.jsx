import { useEffect, useRef, useState } from 'react';
import { Heart, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useActivePromotion } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatKes } from '../utils/format.js';
import CenteredDialog from './CenteredDialog.jsx';
import { usePopupTurn } from './popupQueue.js';

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
export const promoTitleId = (promotion) => `promo-title-${promotion.id || 'preview'}`;

export function PromotionCard({ promotion, onClose, countdown, paused, preview = false }) {
  const titleId = promoTitleId(promotion);
  const go = preview ? (e) => e.preventDefault() : onClose;
  return (
    <div className={`promo-card ${preview ? 'promo-preview' : ''}`}>
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

// Shows the admin's current promotion in the centre of the screen, after its delay and once no
// other popup is open. Readers close it with "Not now", the X, Escape or a click outside.
export default function PromotionPopup() {
  const { user } = useAuth();
  const location = useLocation();
  const { data: promotion } = useActivePromotion(user?.id || 'guest');
  const [ready, setReady] = useState(null);
  const [closed, setClosed] = useState(null);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(0);
  const onSupportPage = location.pathname === '/support';

  // Wait the configured delay (unless this reader has already seen it), then queue it.
  useEffect(() => {
    if (!promotion || onSupportPage || ready?.id === promotion.id || alreadySeen(promotion)) return undefined;
    const timer = setTimeout(() => setReady(promotion), promotion.delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [promotion, onSupportPage, ready]);

  // Hidden if the admin pauses or ends it, or the reader opens the support page.
  const wanted = Boolean(ready && promotion?.id === ready.id && closed !== ready.id && !onSupportPage);
  const visible = usePopupTurn('promotion', wanted) && wanted;
  const close = () => setClosed(ready?.id);

  // Counted as seen once it's actually on screen.
  useEffect(() => {
    if (!visible) return;
    markSeen(ready);
    remaining.current = ready.autoCloseSeconds * 1000;
  }, [visible, ready]);

  // Auto-close, paused while the pointer or keyboard focus is on the card.
  useEffect(() => {
    if (!visible || !ready.autoCloseSeconds || paused) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => setClosed(ready.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [visible, ready, paused]);

  if (!visible) return null;
  return (
    <CenteredDialog
      open
      onClose={close}
      labelledBy={promoTitleId(ready)}
      className="promo-popup"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // The dialog itself takes focus when it opens; only focusing its buttons pauses the timer.
      onFocus={(event) => event.target !== event.currentTarget && setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <PromotionCard promotion={ready} onClose={close} countdown={ready.autoCloseSeconds} paused={paused} />
    </CenteredDialog>
  );
}
