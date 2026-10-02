import { useState } from 'react';
import { CalendarDays, CircleAlert, CircleCheck, Coins, Info, Receipt } from 'lucide-react';
import { useAdminPayments, usePaymentSetup } from '../api/queries.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { formatKes, formatNumber, timeAgo } from '../utils/format.js';

const STATUS_LABELS = { paid: 'Paid', pending: 'Waiting', failed: 'Failed', disputed: 'Under review' };

// 254712345678 → 0712 345 678
const formatPhone = (phone) => (phone ? `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` : '—');

const HUB_VARS = 'ISA_HUB_URL, ISA_HUB_API_KEY and ISA_HUB_WEBHOOK_SECRET';

// Says whether readers can pay right now and, if not, exactly what to fix.
function PaymentSetup() {
  const { data, error, isPending, isFetching, refetch } = usePaymentSetup();
  if (isPending) return null;
  if (error) return <ErrorMessage error={error} />;
  const { mode, hub, webhookUrl } = data;

  let tone = 'error';
  let title;
  let body;
  if (mode === 'hub' && hub.reachable) {
    tone = 'ok';
    title = 'Connected to ISA Tech Hub';
    body = (
      <>
        Payments go through the Hub as <strong>{hub.platform?.name || 'this platform'}</strong>. Customers pay{' '}
        {hub.till?.kind === 'paybill' ? 'Paybill' : 'till'} <strong>{hub.till?.payNumber}</strong>
        {hub.till?.environment === 'sandbox' && ' (sandbox: test money only)'}.
        {hub.till && !hub.till.active && ' The till is switched off in the Hub, so readers can’t pay right now.'}
      </>
    );
  } else if (mode === 'hub') {
    title = 'A-Read can’t use ISA Tech Hub';
    body = hub.error;
  } else if (hub.partial) {
    title = 'ISA Tech Hub is only partly set up';
    body = `Missing on the backend: ${hub.missing.join(', ')}. Add ${hub.missing.length === 1 ? 'it' : 'them'} and redeploy.`;
  } else if (mode === 'daraja') {
    tone = 'info';
    title = 'Payments go straight to Safaricom';
    body = `A-Read is using its own MPESA_* settings. To use ISA Tech Hub instead, set ${HUB_VARS} on the backend and redeploy.`;
  } else {
    title = 'M-Pesa payments are off';
    body = `Readers see “M-Pesa payments aren’t set up yet”. In the Hub dashboard add A-Read under Platforms → Add platform, then set ${HUB_VARS} on the backend and redeploy.`;
  }
  const Icon = tone === 'ok' ? CircleCheck : tone === 'info' ? Info : CircleAlert;

  return (
    <section className={`panel payment-setup setup-${tone}`} aria-live="polite">
      <div className="payment-setup-head">
        <h2 className="panel-title">
          <Icon size={18} aria-hidden="true" /> {title}
        </h2>
        <button type="button" className="button button-small button-ghost" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <p>{body}</p>
      {mode !== 'daraja' && (
        <p className="muted small">
          Webhook URL for A-Read in the Hub dashboard: <code>{webhookUrl}</code>
        </p>
      )}
    </section>
  );
}

export default function AdminPayments() {
  const [status, setStatus] = useState('');
  const { data, isPending, error } = useAdminPayments(status || undefined);

  return (
    <div className="stack">
      <PaymentSetup />
      {data && (
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-icon">
              <Coins size={18} aria-hidden="true" />
            </span>
            <span className="stat-label">Total received</span>
            <strong className="stat-value">{formatKes(data.totals.amount)}</strong>
            <span className="muted small">
              {Object.entries(data.totals.byPurpose)
                .map(([purpose, t]) => `${formatKes(t.amount)} ${purpose}`)
                .join(' · ') || 'Nothing yet'}
            </span>
          </div>
          <div className="stat">
            <span className="stat-icon">
              <CalendarDays size={18} aria-hidden="true" />
            </span>
            <span className="stat-label">This month</span>
            <strong className="stat-value">{formatKes(data.totals.thisMonth)}</strong>
          </div>
          <div className="stat">
            <span className="stat-icon">
              <Receipt size={18} aria-hidden="true" />
            </span>
            <span className="stat-label">Successful payments</span>
            <strong className="stat-value">{formatNumber(data.totals.count)}</strong>
          </div>
        </div>
      )}
      <section className="panel">
        <label className="field payments-filter">
          <span>Show</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All payments</option>
            <option value="paid">Paid</option>
            <option value="pending">Waiting</option>
            <option value="failed">Failed</option>
            <option value="disputed">Under review</option>
          </select>
        </label>
        <ErrorMessage error={error} />
        {isPending ? (
          <Spinner label="Loading payments…" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Payer</th>
                  <th className="num">Amount</th>
                  <th>For</th>
                  <th>Status</th>
                  <th>Receipt</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.user?.name || 'Guest'}</strong>
                      <div className="muted small">{formatPhone(p.phone)}</div>
                    </td>
                    <td className="num">{formatKes(p.amount)}</td>
                    <td className="small">
                      {p.purpose}
                      {p.promotion && <div className="muted small">{p.promotion.title}</div>}
                      {p.book && <div className="muted small">{p.book.title}</div>}
                    </td>
                    <td>
                      <span className={`status-pill payment-${p.status}`} title={p.resultDesc || ''}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="small">{p.receipt || '—'}</td>
                    <td className="muted small">{timeAgo(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.payments.length === 0 && <p className="muted">No payments yet.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
