import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLatest } from '../utils/useLatest.js';

// A popup in the middle of the screen over a dimmed page. Escape, the backdrop or the popup's
// own buttons close it; focus moves into it and returns afterwards.
export default function CenteredDialog({ open, onClose, labelledBy, className = '', children, ...rest }) {
  const panel = useRef(null);
  const close = useLatest(onClose);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    const onKey = (event) => event.key === 'Escape' && close.current?.();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, close]);

  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && close.current?.()}>
      <div ref={panel} className={`dialog-panel ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} {...rest}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
