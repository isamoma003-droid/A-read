import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Bell, BellRing, Check, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { ErrorMessage, Spinner } from './Feedback.jsx';
import { timeAgo } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.jsx';

const DEVICE_TOKEN_KEY = 'a-read-push-token';
const notificationsKey = (userId) => ['notifications', userId];

function storedToken() {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export default function NotificationCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const panel = useRef(null);
  const native = Capacitor.isNativePlatform();
  const userId = user?.id;
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(Boolean(storedToken()));
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [pushError, setPushError] = useState(null);
  const [notificationActionError, setNotificationActionError] = useState(null);
  const { data, isPending, error } = useQuery({
    queryKey: notificationsKey(userId),
    queryFn: () => api('/notifications'),
    enabled: Boolean(userId),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!userId || !native) return undefined;
    let active = true;
    const listeners = [];
    const addListener = async (listenerPromise) => {
      const listener = await listenerPromise;
      if (active) listeners.push(listener);
      else await listener.remove();
    };
    const addListeners = async () => {
      await addListener(
        PushNotifications.addListener('registration', async ({ value: token }) => {
          if (!active) return;
          try {
            await api('/notifications/devices', {
              method: 'POST',
              body: { token, platform: Capacitor.getPlatform() },
            });
            localStorage.setItem(DEVICE_TOKEN_KEY, token);
            setPushEnabled(true);
            setPushMessage('Push notifications are enabled on this device.');
            setPushError(null);
          } catch (registrationError) {
            setPushError(registrationError);
          }
        }),
      );
      await addListener(
        PushNotifications.addListener('registrationError', (registrationError) => {
          if (active) setPushError(new Error(registrationError.error || 'Could not register this device for push notifications.'));
        }),
      );
      await addListener(
        PushNotifications.addListener('pushNotificationReceived', () => {
          queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
        }),
      );
      await addListener(
        PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
          queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
          const notificationId = notification.data?.notificationId;
          if (typeof notificationId === 'string') {
            api(`/notifications/${notificationId}/read`, { method: 'PATCH' }).catch((readError) => setPushError(readError));
          }
          const link = notification.data?.link;
          if (typeof link === 'string' && link.startsWith('/') && !link.startsWith('//')) navigate(link);
        }),
      );
      if (Capacitor.getPlatform() === 'android') {
        await PushNotifications.createChannel({
          id: 'aread-notifications',
          name: 'A-Read notifications',
          description: 'Updates and announcements from A-Read',
          importance: 4,
          vibration: true,
        });
      }
      if (storedToken()) await PushNotifications.register();
    };

    addListeners().catch((registrationError) => active && setPushError(registrationError));
    return () => {
      active = false;
      listeners.forEach((listener) => listener.remove());
    };
  }, [navigate, native, queryClient, userId]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!panel.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  if (!user) return null;

  const markRead = async (item) => {
    setNotificationActionError(null);
    try {
      if (!item.read) {
        await api(`/notifications/${item.id}/read`, { method: 'PATCH' });
        await queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
      }
      if (item.link) {
        navigate(item.link);
        setOpen(false);
      }
    } catch (actionError) {
      setNotificationActionError(actionError);
    }
  };

  const markReadOnly = async (item) => {
    setNotificationActionError(null);
    try {
      await api(`/notifications/${item.id}/read`, { method: 'PATCH' });
      await queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
    } catch (actionError) {
      setNotificationActionError(actionError);
    }
  };

  const enablePush = async () => {
    setPushBusy(true);
    setPushError(null);
    setPushMessage('');
    try {
      let permissions = await PushNotifications.checkPermissions();
      if (permissions.receive !== 'granted') permissions = await PushNotifications.requestPermissions();
      if (permissions.receive !== 'granted') {
        setPushMessage('Notification permission was not granted. You can enable it in your device settings.');
        return;
      }
      await PushNotifications.register();
      setPushMessage('Connecting this device to push notifications…');
    } catch (registrationError) {
      setPushError(registrationError);
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      const token = storedToken();
      if (token) await api('/notifications/devices', { method: 'DELETE', body: { token } });
      await PushNotifications.unregister();
      localStorage.removeItem(DEVICE_TOKEN_KEY);
      setPushEnabled(false);
      setPushMessage('Push notifications are turned off on this device.');
    } catch (registrationError) {
      setPushError(registrationError);
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="notification-center" ref={panel}>
      <button
        type="button"
        className="icon-button notification-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Notifications${data?.unreadCount ? `, ${data.unreadCount} unread` : ''}`}
        title="Notifications"
      >
        {data?.unreadCount ? <BellRing size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
        {data?.unreadCount > 0 && <span className="notification-count">{data.unreadCount > 99 ? '99+' : data.unreadCount}</span>}
      </button>
      {open && (
        <section className="notification-panel" aria-label="Notifications">
          <div className="notification-panel-head">
            <h2>Notifications</h2>
            <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close notifications">
              <X size={16} />
            </button>
          </div>
          {native && (
            <div className="notification-push">
              <div>
                <strong>{pushEnabled ? 'Push notifications on' : 'Get push notifications'}</strong>
                <p className="muted small">Receive A-Read announcements on this device.</p>
              </div>
              <button type="button" className="button button-small" disabled={pushBusy} onClick={pushEnabled ? disablePush : enablePush}>
                {pushBusy ? 'Please wait…' : pushEnabled ? 'Turn off' : 'Enable'}
              </button>
            </div>
          )}
          {pushMessage && <p className="muted small" role="status">{pushMessage}</p>}
          <ErrorMessage error={pushError || notificationActionError || error} />
          {isPending ? (
            <Spinner label="Loading notifications…" />
          ) : data?.notifications.length ? (
            <ul className="notification-list">
              {data.notifications.map((item) => (
                <li key={item.id} className={item.read ? '' : 'notification-unread'}>
                  <button type="button" className="notification-item" onClick={() => markRead(item)}>
                    <span className="notification-item-top">
                      <strong>{item.title}</strong>
                      {!item.read && <span className="notification-unread-dot" aria-label="Unread" />}
                    </span>
                    <span>{item.body}</span>
                    <span className="muted small">{timeAgo(item.createdAt)}</span>
                  </button>
                  {!item.read && (
                    <button
                      type="button"
                      className="icon-button notification-mark-read"
                      onClick={() => markReadOnly(item)}
                      title="Mark as read"
                    >
                      <Check size={15} aria-hidden="true" />
                      <span className="sr-only">Mark as read</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small notification-empty">You’re all caught up.</p>
          )}
        </section>
      )}
    </div>
  );
}
