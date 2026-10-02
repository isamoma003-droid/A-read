import { useState } from 'react';
import { LockOpen } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, usePaymentConfig } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatKes } from '../utils/format.js';
import { ErrorMessage, Spinner } from './Feedback.jsx';
import { PaymentStatus, savePhone, savedPhone } from './MpesaPayment.jsx';

// The payment waiting for M-Pesa's answer, per reader and book, so a reload keeps following it.
// Like the server, it stops waiting after five minutes.
const pendingKey = (userId, bookId) => `a-read-unlock-${userId}-${bookId}`;
const WAIT_MS = 5 * 60 * 1000;
function pendingPayment(userId, bookId) {
  if (!userId) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(pendingKey(userId, bookId)) || 'null');
    return saved?.id && Date.now() - saved.at < WAIT_MS ? saved.id : null;
  } catch {
    return null;
  }
}
function rememberPayment(userId, bookId, paymentId) {
  try {
    if (paymentId) localStorage.setItem(pendingKey(userId, bookId), JSON.stringify({ id: paymentId, at: Date.now() }));
    else localStorage.removeItem(pendingKey(userId, bookId));
  } catch {
    // ignore
  }
}

// Pays a premium book's price by M-Pesa STK Push. Once M-Pesa confirms, the book, its chapter
// list and its text are fetched again, now unlocked. `price` overrides the book's when the book
// data is older than the lock (the server's 402 answer carries the price).
export default function UnlockBook({ book, price: priceOverride }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: config } = usePaymentConfig();
  const [phone, setPhone] = useState(savedPhone);
  const [paymentId, setPaymentIdState] = useState(() => pendingPayment(user?.id, book.id));
  const setPaymentId = (id) => {
    rememberPayment(user?.id, book.id, id);
    setPaymentIdState(id);
  };
  const price = priceOverride ?? book.premium?.price;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!user) {
    return (
      <Link to="/login" state={{ from: `/books/${book.id}` }} className="button button-primary">
        <LockOpen size={16} aria-hidden="true" /> Sign in to unlock
      </Link>
    );
  }

  const onPaid = () => {
    rememberPayment(user?.id, book.id, null);
    queryClient.invalidateQueries({ queryKey: keys.book(book.id) });
    queryClient.invalidateQueries({ queryKey: keys.sections(book.id) });
    queryClient.invalidateQueries({ queryKey: ['section', book.id] });
    queryClient.invalidateQueries({ queryKey: ['books'] });
  };

  if (paymentId) {
    return (
      <PaymentStatus
        id={paymentId}
        onRetry={() => setPaymentId(null)}
        onClose={() => setPaymentId(null)}
        // Answered either way: a reload shows the book (paid) or the form again.
        onSettled={() => rememberPayment(user?.id, book.id, null)}
        onPaid={onPaid}
        paidTitle="Book unlocked"
        paidText="Every chapter is open now, on all your devices."
      />
    );
  }
  if (config && !config.enabled) {
    return <p className="notice">M-Pesa payments aren't set up yet, so this book can't be unlocked right now.</p>;
  }
  if (!price) return <Spinner label="Checking the price…" />;

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // If a prompt for this book is still open, the server hands that payment back instead of
      // sending another.
      const { payment } = await api('/payments/stk', { method: 'POST', body: { phone, bookId: book.id } });
      savePhone(phone);
      setPaymentId(payment.id);
    } catch (err) {
      // Paid on another device in the meantime.
      if (err.status === 409) onPaid();
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form unlock-form" onSubmit={onSubmit}>
      <label className="field">
        <span>M-Pesa phone number</span>
        <input type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" required value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <ErrorMessage error={error} />
      <button className="button button-primary" disabled={busy}>
        <LockOpen size={16} aria-hidden="true" /> {busy ? 'Sending request…' : `Unlock for ${formatKes(price)}`}
      </button>
      <p className="muted small">You'll get a prompt on your phone. Enter your M-Pesa PIN there to pay once and keep the whole book.</p>
    </form>
  );
}
