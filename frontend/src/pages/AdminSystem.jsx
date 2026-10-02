import { useState } from 'react';
import { Activity, CircleAlert, CircleCheck, Megaphone, RefreshCw, Settings2, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { keys, useSystemStatus } from '../api/queries.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { formatNumber, timeAgo } from '../utils/format.js';

// Super admins only: site-wide settings and the health of every service A-Read depends on.
export default function AdminSystem() {
  const { data, isPending, error, refetch, isFetching } = useSystemStatus();
  if (isPending) return <Spinner label="Checking the system…" />;
  if (error) return <ErrorMessage error={error} />;
  return (
    <div className="stack">
      <SettingsForm settings={data.settings} />
      <section className="panel">
        <div className="payment-setup-head">
          <h2 className="panel-title">
            <Activity size={18} aria-hidden="true" /> Services
          </h2>
          <button type="button" className="button button-small button-ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} aria-hidden="true" /> {isFetching ? 'Checking…' : 'Check again'}
          </button>
        </div>
        <ul className="service-list">
          {data.services.map((s) => (
            <li key={s.id} className={s.ok ? 'is-ok' : 'is-off'}>
              {s.ok ? <CircleCheck size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
              <span>
                <strong>{s.label}</strong>
                <span className="muted small">{s.detail}</span>
              </span>
            </li>
          ))}
          <HubRow hub={data.hub} onWoken={() => setTimeout(() => refetch(), 4000)} />
        </ul>
      </section>
      <section className="panel">
        <h2 className="panel-title">
          <Users size={18} aria-hidden="true" /> People and content
        </h2>
        <div className="stat-grid">
          {[
            ['Accounts', data.counts.users],
            ['Admins', data.counts.admins],
            ['Super admins', data.counts.superAdmins],
            ['Books', data.counts.books],
            ['Quotes showing', data.counts.quotes],
          ].map(([label, value]) => (
            <div key={label} className="stat">
              <span className="stat-label">{label}</span>
              <strong className="stat-value">{formatNumber(value)}</strong>
            </div>
          ))}
        </div>
        <p className="muted small">
          Change roles in the Users tab. Accounts listed in SUPER_ADMIN_EMAILS on the server are always super admins.
        </p>
      </section>
    </div>
  );
}

// The app wakes ISA Tech Hub each time it's opened; this shows how the last wake-up went.
function HubRow({ hub, onWoken }) {
  const [busy, setBusy] = useState(false);
  if (!hub.enabled) {
    return (
      <li className="is-off">
        <CircleAlert size={18} aria-hidden="true" />
        <span>
          <strong>ISA Tech Hub wake-up</strong>
          <span className="muted small">Not used: the ISA_HUB_* settings aren't all set.</span>
        </span>
      </li>
    );
  }
  const last = hub.last;
  const wake = async () => {
    setBusy(true);
    await api('/system/wake').catch(() => {});
    setBusy(false);
    onWoken();
  };
  const ok = last?.ok;
  return (
    <li className={ok ? 'is-ok' : 'is-off'}>
      {ok ? <CircleCheck size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
      <span>
        <strong>ISA Tech Hub wake-up</strong>
        <span className="muted small">
          {hub.waking
            ? 'Waking it now…'
            : !last
              ? 'Not woken since the server started. It will be the next time someone opens the app.'
              : ok
                ? `Awake: answered ${timeAgo(last.at)} in ${(last.ms / 1000).toFixed(1)} s. Woken each time the app is opened.`
                : `Didn't answer ${timeAgo(last.at)}: ${last.error}`}
        </span>
      </span>
      <button type="button" className="button button-small" onClick={wake} disabled={busy || hub.waking}>
        Wake now
      </button>
    </li>
  );
}

function SettingsForm({ settings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const set = (change) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...change }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { settings: next } = await api('/system/settings', {
        method: 'PUT',
        body: { signupsOpen: form.signupsOpen, uploads: form.uploads, quotesEnabled: form.quotesEnabled, announcement: form.announcement },
      });
      setForm((f) => ({ ...f, ...next }));
      setSaved(true);
      queryClient.setQueryData(keys.systemConfig, next);
      queryClient.invalidateQueries({ queryKey: keys.systemStatus });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel form" onSubmit={onSubmit}>
      <h2 className="panel-title">
        <Settings2 size={18} aria-hidden="true" /> Site settings
      </h2>
      <label className="checkbox system-option">
        <input type="checkbox" checked={form.signupsOpen} onChange={(e) => set({ signupsOpen: e.target.checked })} />
        <span>
          <strong>New sign-ups are open</strong>
          <span className="muted small">When off, only people listed in ADMIN_EMAILS or SUPER_ADMIN_EMAILS can create accounts. Members still sign in.</span>
        </span>
      </label>
      <label className="checkbox system-option">
        <input type="checkbox" checked={form.quotesEnabled} onChange={(e) => set({ quotesEnabled: e.target.checked })} />
        <span>
          <strong>Show a book quote when the app opens</strong>
          <span className="muted small">Admins manage the quotes in the Quotes tab.</span>
        </span>
      </label>
      <label className="field system-select">
        <span>Who can upload books</span>
        <select value={form.uploads} onChange={(e) => set({ uploads: e.target.value })}>
          <option value="everyone">Everyone with an account</option>
          <option value="admins">Admins only</option>
        </select>
      </label>
      <label className="field">
        <span>
          <Megaphone size={14} aria-hidden="true" /> Announcement at the top of every page
        </span>
        <textarea
          rows={2}
          maxLength={300}
          value={form.announcement}
          onChange={(e) => set({ announcement: e.target.value })}
          placeholder="e.g. A-Read will be down for maintenance tonight from 10 pm. Leave empty for none."
        />
      </label>
      <ErrorMessage error={error} />
      <div className="button-row">
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="muted small">Saved. Everyone sees the change within a few seconds.</span>}
        {!saved && settings.updatedAt && <span className="muted small">Last changed {timeAgo(settings.updatedAt)}</span>}
      </div>
    </form>
  );
}
