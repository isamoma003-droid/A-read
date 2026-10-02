import { useEffect, useRef } from 'react';
import { CircleAlert, CircleCheck, CircleX, Smartphone } from 'lucide-react';
import { usePayment } from '../api/queries.js';
import { formatKes } from '../utils/format.js';
import { ErrorMessage, Spinner } from './Feedback.jsx';

const PHONE_KEY = 'a-read-mpesa-phone';

// The last M-Pesa number used on this device, so readers don't type it twice.
export function savedPhone() {
  try {
    return localStorage.getItem(PHONE_KEY) || '';
  } catch {
    return '';
  }
}

export function savePhone(phone) {
  try {
    localStorage.setItem(PHONE_KEY, phone);
  } catch {
    // ignore
  }
}

// Follows one STK Push payment until M-Pesa answers. `onPaid` runs once when it's paid.
export function PaymentStatus({ id, onRetry, onPaid, paidTitle = 'Thank you!', paidText }) {
  const { data: payment, error } = usePayment(id);
  const paid = payment?.status === 'paid';
  const reported = useRef(false);
  useEffect(() => {
    if (paid && !reported.current) {
      reported.current = true;
      onPaid?.(payment);
    }
  }, [paid, payment, onPaid]);

  if (error) return <ErrorMessage error={error} />;
  if (!payment || payment.status === 'pending') {
    return (
      <section className="panel payment-status" aria-live="polite">
        <Smartphone size={40} strokeWidth={1.5} aria-hidden="true" />
        <h2>Check your phone</h2>
        <p>Enter your M-Pesa PIN on the prompt to pay {payment ? formatKes(payment.amount) : ''}.</p>
        <Spinner label="Waiting for M-Pesa…" />
      </section>
    );
  }
  if (paid) {
    return (
      <section className="panel payment-status payment-paid" aria-live="polite">
        <CircleCheck size={40} strokeWidth={1.5} aria-hidden="true" />
        <h2>{paidTitle}</h2>
        <p>{paidText || `We received ${formatKes(payment.amount)}.`}</p>
        {payment.receipt && <p className="muted small">M-Pesa receipt {payment.receipt}</p>}
      </section>
    );
  }
  if (payment.status === 'disputed') {
    return (
      <section className="panel payment-status payment-disputed" aria-live="polite">
        <CircleAlert size={40} strokeWidth={1.5} aria-hidden="true" />
        <h2>We're checking this payment</h2>
        <p>{payment.message}</p>
        {payment.receipt && <p className="muted small">M-Pesa receipt {payment.receipt}</p>}
      </section>
    );
  }
  return (
    <section className="panel payment-status payment-failed" aria-live="polite">
      <CircleX size={40} strokeWidth={1.5} aria-hidden="true" />
      <h2>Payment not completed</h2>
      <p>{payment.message}</p>
      <button type="button" className="button button-primary" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}
