import { useState } from 'react';
import { Heart, Smartphone } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePaymentConfig } from '../api/queries.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { PaymentStatus, savePhone, savedPhone } from '../components/MpesaPayment.jsx';
import { formatKes } from '../utils/format.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

const AMOUNTS = [50, 100, 200, 500, 1000];

export default function SupportPage() {
  useDocumentTitle('Support A-Read');
  const [params] = useSearchParams();
  const promotionId = params.get('promo');
  const { data: config, isPending, error: configError } = usePaymentConfig();
  const [amount, setAmount] = useState(() => Number(params.get('amount')) || 100);
  const [phone, setPhone] = useState(savedPhone);
  const [paymentId, setPaymentId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (isPending) return <Spinner label="Loading…" />;

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { payment } = await api('/payments/stk', { method: 'POST', body: { phone, amount, promotionId } });
      savePhone(phone);
      setPaymentId(payment.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow support">
      <header className="page-header">
        <p className="eyebrow">
          <Heart size={12} aria-hidden="true" /> Support us
        </p>
        <h1 className="section-title">Help keep A-Read going</h1>
        <p className="muted">Your support pays for storage and narration so everyone can keep reading and listening for free.</p>
      </header>
      <ErrorMessage error={configError} />

      {paymentId ? (
        <PaymentStatus id={paymentId} onRetry={() => setPaymentId(null)} />
      ) : config?.enabled ? (
        <form className="panel form" onSubmit={onSubmit}>
          <h2 className="panel-title">
            <Smartphone size={18} aria-hidden="true" /> Pay with M-Pesa
          </h2>
          <fieldset className="setting">
            <legend>Amount</legend>
            <div className="tag-row">
              {AMOUNTS.map((a) => (
                <button key={a} type="button" className={`chip ${amount === a ? 'chip-active' : ''}`} onClick={() => setAmount(a)} aria-pressed={amount === a}>
                  {formatKes(a)}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Or enter an amount (KES)</span>
              <input
                type="number"
                inputMode="numeric"
                min={config.minAmount}
                max={config.maxAmount}
                step={1}
                required
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </label>
          </fieldset>
          <label className="field">
            <span>M-Pesa phone number</span>
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <ErrorMessage error={error} />
          <button className="button button-primary button-block" disabled={busy}>
            {busy ? 'Sending request…' : `Pay ${formatKes(amount || 0)}`}
          </button>
          <p className="muted small">You'll get a prompt on your phone. Enter your M-Pesa PIN there to confirm. We never see your PIN.</p>
        </form>
      ) : (
        !config?.number && <p className="notice">M-Pesa payments aren't set up yet. Please check back soon.</p>
      )}

      {config?.number && <ManualPayment config={config} />}
    </div>
  );
}

function ManualPayment({ config }) {
  return (
    <section className="panel">
      <h2 className="panel-title">Prefer the M-Pesa menu?</h2>
      <ol className="manual-steps">
        <li>Open M-Pesa and choose Lipa na M-Pesa</li>
        {config.method === 'till' ? (
          <li>
            Buy Goods and Services, Till number <strong className="till">{config.number}</strong>
          </li>
        ) : (
          <li>
            Pay Bill, business number <strong className="till">{config.number}</strong>, account <strong>{config.accountReference}</strong>
          </li>
        )}
        <li>Enter the amount and your PIN</li>
      </ol>
    </section>
  );
}
