import { useState } from 'react';
import { Crown, LogIn } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, usePaymentConfig } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatKes } from '../utils/format.js';
import { ErrorMessage } from './Feedback.jsx';
import { PaymentStatus, pendingPayment, rememberPayment, savePhone, savedPhone } from './MpesaPayment.jsx';

const pendingKey = (userId) => (userId ? `a-read-pass-${userId}` : null);

// Buys (or extends) the Premium Pass by M-Pesa STK Push. Once M-Pesa confirms, every premium
// book is fetched again, now unlocked.
export default function PassCheckout({ pass }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: config } = usePaymentConfig();
  const [phone, setPhone] = useState(savedPhone);
  const [paymentId, setPaymentIdState] = useState(() => pendingPayment(pendingKey(user?.id)));
  const setPaymentId = (id) => {
    rememberPayment(pendingKey(user?.id), id);
    setPaymentIdState(id);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!user) {
    return (
      <Link to="/login" state={{ from: '/premium' }} className="button button-primary">
        <LogIn size={16} aria-hidden="true" /> Sign in to get the pass
      </Link>
    );
  }

  const onPaid = () => {
    rememberPayment(pendingKey(user.id), null);
    for (const key of [keys.pass, ['books'], ['book'], ['sections'], ['section']]) queryClient.invalidateQueries({ queryKey: key });
  };

  if (paymentId) {
    return (
      <PaymentStatus
        id={paymentId}
        onRetry={() => setPaymentId(null)}
        onClose={() => setPaymentId(null)}
        onSettled={(payment) => payment.status === 'failed' && rememberPayment(pendingKey(user.id), null)}
        onPaid={onPaid}
        paidTitle="Your Premium Pass is on"
        paidText={`Every premium book is open for the next ${pass.days} days, on all your devices.`}
      />
    );
  }
  if (config && !config.enabled) return <p className="notice">M-Pesa payments aren't set up yet, so the pass can't be bought right now.</p>;

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // If a prompt for the pass is still open, the server hands that payment back instead.
      const { payment } = await api('/payments/stk', { method: 'POST', body: { phone, pass: true } });
      savePhone(phone);
      setPaymentId(payment.id);
    } catch (err) {
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
        <Crown size={16} aria-hidden="true" />{' '}
        {busy ? 'Sending request…' : pass.active ? `Add ${pass.days} days for ${formatKes(pass.price)}` : `Get the pass for ${formatKes(pass.price)}`}
      </button>
      <p className="muted small">
        You'll get a prompt on your phone. Enter your M-Pesa PIN there to pay once. It doesn't renew by itself.
      </p>
    </form>
  );
}
