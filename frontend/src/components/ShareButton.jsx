import { useState } from 'react';
import { Check, Copy, Mail, Share2, X } from 'lucide-react';
import CenteredDialog from './CenteredDialog.jsx';
import { usePopupTurn } from './popupQueue.js';

// Brand marks drawn inline (lucide doesn't ship brand logos).
const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z" />
  </svg>
);
const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
    <path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.5 13.2l-4.7-1.5c-1-.3-1-1 .2-1.5l18.5-7.1c.9-.3 1.6.2 1.4 1.2Z" />
  </svg>
);
const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
    <path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.5 1.6-1.5h1.6V4.4a22 22 0 0 0-2.4-.1c-2.4 0-4 1.4-4 4.1v2.4H7.6V14h2.7v8h3.2Z" />
  </svg>
);
const XIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
    <path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.2l-4.9-6.3L5.4 21H2.3l7.2-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />
  </svg>
);

// Links use this site's own address. On Vercel, /share/books/:id is answered by a function that
// returns link-preview tags (title, cover) and then opens the book page.
export function shareLink(book) {
  return `${window.location.origin}/share/books/${book.id}`;
}

export default function ShareButton({ book, className = 'button' }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Opened by the reader, so it goes ahead of any popup that's waiting.
  const turn = usePopupTurn(`share-${book.id}`, open, { first: true });
  const url = shareLink(book);
  const text = `Read “${book.title}”${book.author ? ` by ${book.author}` : ''} on A-Read`;
  const encoded = { url: encodeURIComponent(url), text: encodeURIComponent(text), both: encodeURIComponent(`${text}\n${url}`) };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this link:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: book.title, text, url });
      setOpen(false);
    } catch {
      // Cancelled.
    }
  };

  const targets = [
    { name: 'WhatsApp', icon: WhatsAppIcon, href: `https://wa.me/?text=${encoded.both}`, cls: 'share-whatsapp' },
    { name: 'Telegram', icon: TelegramIcon, href: `https://t.me/share/url?url=${encoded.url}&text=${encoded.text}`, cls: 'share-telegram' },
    { name: 'Facebook', icon: FacebookIcon, href: `https://www.facebook.com/sharer/sharer.php?u=${encoded.url}`, cls: 'share-facebook' },
    { name: 'X', icon: XIcon, href: `https://twitter.com/intent/tweet?text=${encoded.text}&url=${encoded.url}`, cls: 'share-x' },
    { name: 'Email', icon: () => <Mail size={18} aria-hidden="true" />, href: `mailto:?subject=${encodeURIComponent(book.title)}&body=${encoded.both}`, cls: 'share-email' },
  ];

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-expanded={open} aria-haspopup="dialog">
        <Share2 size={16} aria-hidden="true" /> Share
      </button>
      <CenteredDialog open={open && turn} onClose={() => setOpen(false)} labelledBy={`share-title-${book.id}`} className="share-menu">
        <div className="share-head">
          <p className="share-heading" id={`share-title-${book.id}`}>
            Share “{book.title}”
          </p>
          <button type="button" className="icon-button" onClick={() => setOpen(false)} title="Close">
            <X size={18} />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="share-grid">
          {targets.map(({ name, icon: Icon, href, cls }) => (
            <a key={name} href={href} target="_blank" rel="noopener noreferrer" className={`share-target ${cls}`} onClick={() => setOpen(false)}>
              <span className="share-icon">
                <Icon />
              </span>
              {name}
            </a>
          ))}
        </div>
        <div className="share-link">
          <input value={url} readOnly aria-label="Share link" onFocus={(e) => e.target.select()} />
          <button type="button" className="button button-small" onClick={copy}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {typeof navigator.share === 'function' && (
          <button type="button" className="button button-small button-block" onClick={nativeShare}>
            More apps…
          </button>
        )}
      </CenteredDialog>
    </>
  );
}
