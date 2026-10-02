import { useState } from 'react';
import { Megaphone, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { usePromotions } from '../api/queries.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { PromotionCard } from '../components/PromotionPopup.jsx';
import { formatKes } from '../utils/format.js';

const STATE_LABELS = { live: 'Live now', scheduled: 'Scheduled', ended: 'Ended', paused: 'Paused', 'off-hours': 'Outside daily hours' };
const AUDIENCE_LABELS = { everyone: 'Everyone', users: 'Signed-in readers', guests: 'Visitors not signed in' };
const FREQUENCY_LABELS = { visit: 'Every time the app opens', session: 'Once per browser session', day: 'Once a day', once: 'Only once' };

// <input type="datetime-local"> works in the admin's own time zone.
const toLocalInput = (date) => {
  const d = new Date(date);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const formatWhen = (date) => new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function invalidate(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['admin', 'promotions'] });
  queryClient.invalidateQueries({ queryKey: ['promotion'] });
}

export default function AdminPromotions() {
  const { data, isPending, error } = usePromotions();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | promotion
  const [actionError, setActionError] = useState(null);

  const run = async (request) => {
    setActionError(null);
    try {
      await request();
      invalidate(queryClient);
    } catch (err) {
      setActionError(err);
    }
  };

  const togglePause = (p) => run(() => api(`/promotions/${p.id}`, { method: 'PATCH', body: { paused: !p.paused } }));
  const remove = (p) => {
    if (!window.confirm(`Delete the "${p.title}" popup? Payments made through it are kept.`)) return;
    run(() => api(`/promotions/${p.id}`, { method: 'DELETE' }));
  };

  return (
    <div className="stack">
      {editing ? (
        <PromotionForm promotion={editing === 'new' ? null : editing} timeZone={data?.timeZone} onDone={() => setEditing(null)} />
      ) : (
        <div>
          <button type="button" className="button button-primary" onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> New popup
          </button>
        </div>
      )}
      <section className="panel">
        <h2 className="panel-title">
          <Megaphone size={18} aria-hidden="true" /> Support popups
        </h2>
        <p className="muted small">
          Popups appear in the middle of the screen on the library and book pages (never inside the reader), one at a time, and readers can always close them.
        </p>
        <ErrorMessage error={error || actionError} />
        {isPending && <Spinner label="Loading…" />}
        {data?.promotions.length === 0 && <p className="muted">No popups yet. Create one to ask readers for support over M-Pesa.</p>}
        <ul className="assignment-admin-list">
          {data?.promotions.map((p) => (
            <li key={p.id} className="promo-row">
              <div>
                <strong>{p.title}</strong> <span className={`status-pill promo-state-${p.state}`}>{STATE_LABELS[p.state]}</span>
                <div className="muted small">
                  {formatWhen(p.startsAt)} to {formatWhen(p.endsAt)}
                  {p.dailyFrom && ` · daily ${p.dailyFrom}–${p.dailyTo} (${data.timeZone})`}
                </div>
                <div className="muted small">
                  {AUDIENCE_LABELS[p.audience]} · {FREQUENCY_LABELS[p.frequency]} ·{' '}
                  {p.autoCloseSeconds ? `closes after ${p.autoCloseSeconds}s` : 'stays until closed'}
                  {p.purpose !== 'donation' && ` · purpose: ${p.purpose}`}
                </div>
              </div>
              <div className="promo-raised">
                <strong>{formatKes(p.raised)}</strong>
                <span className="muted small">
                  {p.payments} payment{p.payments === 1 ? '' : 's'}
                </span>
              </div>
              <div className="actions">
                {p.state !== 'ended' && (
                  <button type="button" className="button button-small button-ghost" onClick={() => togglePause(p)}>
                    {p.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />} {p.paused ? 'Resume' : 'Pause'}
                  </button>
                )}
                <button type="button" className="icon-button" onClick={() => setEditing(p)} title="Edit">
                  <Pencil size={16} />
                  <span className="sr-only">Edit {p.title}</span>
                </button>
                <button type="button" className="icon-button danger" onClick={() => remove(p)} title="Delete">
                  <Trash2 size={16} />
                  <span className="sr-only">Delete {p.title}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const parseAmounts = (text) =>
  text
    .split(/[,\s]+/)
    .map((t) => Number(t))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 6);

function PromotionForm({ promotion, timeZone = 'Africa/Nairobi', onDone }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => {
    const now = Date.now();
    return {
      title: promotion?.title ?? 'Help keep A-Read free',
      message: promotion?.message ?? 'If A-Read helps you read and listen, a small M-Pesa contribution keeps the books and narration going.',
      buttonLabel: promotion?.buttonLabel ?? 'Support us',
      amounts: (promotion?.amounts ?? [50, 100, 500]).join(', '),
      purpose: promotion?.purpose ?? 'donation',
      audience: promotion?.audience ?? 'everyone',
      startsAt: toLocalInput(promotion?.startsAt ?? now),
      endsAt: toLocalInput(promotion?.endsAt ?? now + 7 * 24 * 3600 * 1000),
      daily: Boolean(promotion?.dailyFrom),
      dailyFrom: promotion?.dailyFrom ?? '18:00',
      dailyTo: promotion?.dailyTo ?? '22:00',
      delaySeconds: promotion?.delaySeconds ?? 5,
      autoCloseSeconds: promotion?.autoCloseSeconds ?? 0,
      frequency: promotion?.frequency ?? 'session',
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      title: form.title,
      message: form.message,
      buttonLabel: form.buttonLabel,
      amounts: parseAmounts(form.amounts),
      purpose: form.purpose.trim().toLowerCase(),
      audience: form.audience,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      dailyFrom: form.daily ? form.dailyFrom : null,
      dailyTo: form.daily ? form.dailyTo : null,
      delaySeconds: Number(form.delaySeconds),
      autoCloseSeconds: Number(form.autoCloseSeconds),
      frequency: form.frequency,
    };
    try {
      if (promotion) await api(`/promotions/${promotion.id}`, { method: 'PATCH', body });
      else await api('/promotions', { method: 'POST', body });
      invalidate(queryClient);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="promo-editor">
      <form className="panel form" onSubmit={onSubmit}>
        <h2 className="panel-title">{promotion ? 'Edit popup' : 'New popup'}</h2>
        <label className="field">
          <span>Title</span>
          <input value={form.title} onChange={set('title')} maxLength={120} required />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea rows={3} value={form.message} onChange={set('message')} maxLength={1000} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Button label</span>
            <input value={form.buttonLabel} onChange={set('buttonLabel')} maxLength={40} required />
          </label>
          <label className="field">
            <span>Quick amounts (KES, up to 6)</span>
            <input value={form.amounts} onChange={set('amounts')} placeholder="50, 100, 500" />
          </label>
        </div>

        <fieldset className="form-section">
          <legend>When it runs</legend>
          <div className="form-grid">
            <label className="field">
              <span>Starts</span>
              <input type="datetime-local" value={form.startsAt} onChange={set('startsAt')} required />
            </label>
            <label className="field">
              <span>Ends</span>
              <input type="datetime-local" value={form.endsAt} onChange={set('endsAt')} required />
            </label>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={form.daily} onChange={set('daily')} /> Only during certain hours each day
          </label>
          {form.daily && (
            <div className="form-grid">
              <label className="field">
                <span>From ({timeZone})</span>
                <input type="time" value={form.dailyFrom} onChange={set('dailyFrom')} required />
              </label>
              <label className="field">
                <span>Until ({timeZone})</span>
                <input type="time" value={form.dailyTo} onChange={set('dailyTo')} required />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className="form-section">
          <legend>How it shows</legend>
          <div className="form-grid">
            <label className="field">
              <span>Who sees it</span>
              <select value={form.audience} onChange={set('audience')}>
                {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>How often per reader</span>
              <select value={form.frequency} onChange={set('frequency')}>
                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Appears after (seconds)</span>
              <input type="number" min={0} max={300} value={form.delaySeconds} onChange={set('delaySeconds')} required />
            </label>
            <label className="field">
              <span>Closes itself after (seconds, 0 = stays until closed)</span>
              <input type="number" min={0} max={600} value={form.autoCloseSeconds} onChange={set('autoCloseSeconds')} required />
            </label>
          </div>
        </fieldset>

        <label className="field">
          <span>Payment purpose</span>
          <input value={form.purpose} onChange={set('purpose')} pattern="[a-z0-9\-]{1,40}" required />
          <span className="muted small">Leave as "donation", or name a feature (e.g. "premium") to unlock it for payers later.</span>
        </label>

        <ErrorMessage error={error} />
        <div className="button-row">
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : promotion ? 'Save changes' : 'Create popup'}
          </button>
          <button type="button" className="button button-ghost" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
      <aside className="promo-preview-wrap">
        <p className="muted small">Preview</p>
        <PromotionCard promotion={{ ...form, amounts: parseAmounts(form.amounts) }} onClose={() => {}} preview />
      </aside>
    </div>
  );
}
