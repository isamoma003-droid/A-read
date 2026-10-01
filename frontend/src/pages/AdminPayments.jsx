import { useState } from 'react';
import { CalendarDays, Coins, Receipt } from 'lucide-react';
import { useAdminPayments } from '../api/queries.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { formatKes, formatNumber, timeAgo } from '../utils/format.js';

const STATUS_LABELS = { paid: 'Paid', pending: 'Waiting', failed: 'Failed' };

// 254712345678 → 0712 345 678
const formatPhone = (phone) => (phone ? `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` : '—');

export default function AdminPayments() {
  const [status, setStatus] = useState('');
  const { data, isPending, error } = useAdminPayments(status || undefined);

  return (
    <div className="stack">
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
