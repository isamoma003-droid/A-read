import { useState } from 'react';
import { LockOpen } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, usePaymentConfig } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatKes } from '../utils/format.js';
import { ErrorMessage } from './Feedback.jsx';
import { PaymentStatus, savePhone, savedPhone } from './MpesaPayment.jsx';

// Pays a premium book's price by M-Pesa STK Push. Once M-Pesa confirms, the book, its chapter
// list and its text are fetched again, now unlocked.
export default function UnlockBook({ book }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: config } = usePaymentConfig();
  const [phone, setPhone] = useState(savedPhone);
  const [paymentId, setPaymentId] = useState(null);
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
        onPaid={onPaid}
        paidTitle="Book unlocked"
        paidText="Every chapter is open now, on all your devices."
      />
    );
  }
  if (config && !config.enabled) {
    return <p className="notice">M-Pesa payments aren't set up yet, so this book can't be unlocked right now.</p>;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
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
        <LockOpen size={16} aria-hidden="true" /> {busy ? 'Sending request…' : `Unlock for ${formatKes(book.premium.price)}`}
      </button>
      <p className="muted small">You'll get a prompt on your phone. Enter your M-Pesa PIN there to pay once and keep the whole book.</p>
    </form>
  );
}
