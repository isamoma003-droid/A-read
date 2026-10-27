import { useState } from 'react';
import { Bell, Send, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { timeAgo } from '../utils/format.js';

const adminKey = ['admin', 'notifications'];
const EMPTY_FORM = { title: '', body: '', link: '' };

export default function AdminNotifications() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: adminKey,
    queryFn: () => api('/notifications/admin'),
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [feedback, setFeedback] = useState('');

  const publish = async (event) => {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    setFeedback('');
    try {
      const { push } = await api('/notifications/admin', { method: 'POST', body: form });
      setForm(EMPTY_FORM);
      setFeedback(
        !push.configured
          ? 'Published in the app. Push is not configured on the server yet.'
          : push.error
            ? push.error
            : `Published in the app. Push sent to ${push.sent} device${push.sent === 1 ? '' : 's'}${push.failed ? `; ${push.failed} failed` : ''}.`,
      );
      await queryClient.invalidateQueries({ queryKey: adminKey });
    } catch (requestError) {
      setActionError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (notification) => {
    if (!window.confirm(`Delete “${notification.title}” for everyone?`)) return;
    setActionError(null);
    try {
      await api(`/notifications/admin/${notification.id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: adminKey });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (requestError) {
      setActionError(requestError);
    }
  };

  if (isPending) return <Spinner label="Loading notifications…" />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div className="stack">
      <form className="panel form" onSubmit={publish}>
        <h2 className="panel-title">
          <Send size={18} aria-hidden="true" /> Send a notification
        </h2>
        <p className="muted small">
          Publish to every reader’s in-app notification center. {data.pushConfigured
            ? `${data.registeredDevices} device${data.registeredDevices === 1 ? '' : 's'} registered for push notifications.`
            : 'Push delivery is off until Firebase is configured on the server and Android app.'}
        </p>
        <label className="field">
          <span>Title</span>
          <input value={form.title} maxLength={120} required onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea rows={3} value={form.body} maxLength={1000} required onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} />
        </label>
        <label className="field">
          <span>Optional in-app link</span>
          <input
            value={form.link}
            maxLength={300}
            placeholder="/support"
            pattern="/(?!/).*"
            title="Enter an A-Read path beginning with /"
            onChange={(event) => setForm((current) => ({ ...current, link: event.target.value }))}
          />
        </label>
        <ErrorMessage error={actionError} />
        {feedback && <p className="muted small" role="status">{feedback}</p>}
        <button className="button button-primary" disabled={busy}>
          <Send size={15} aria-hidden="true" /> {busy ? 'Publishing…' : 'Publish to everyone'}
        </button>
      </form>

      <section className="panel">
        <h2 className="panel-title">
          <Bell size={18} aria-hidden="true" /> Recent notifications
        </h2>
        {data.notifications.length ? (
          <ul className="admin-notification-list">
            {data.notifications.map((notification) => (
              <li key={notification.id}>
                <div>
                  <strong>{notification.title}</strong>
                  <p>{notification.body}</p>
                  {notification.link && <span className="muted small">{notification.link} · </span>}
                  <span className="muted small">{timeAgo(notification.createdAt)}</span>
                </div>
                <button type="button" className="icon-button danger" onClick={() => remove(notification)} title="Delete notification">
                  <Trash2 size={16} aria-hidden="true" />
                  <span className="sr-only">Delete notification</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No notifications have been sent yet.</p>
        )}
      </section>
    </div>
  );
}
