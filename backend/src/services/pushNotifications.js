import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env.js';
import { PushToken } from '../models/Notification.js';

const APP_NAME = 'a-read-notifications';
let messaging;

export const isPushConfigured = () => Boolean(env.firebaseServiceAccountJson);

function getMessagingClient() {
  if (!isPushConfigured()) return null;
  if (messaging) return messaging;

  let account;
  try {
    account = JSON.parse(env.firebaseServiceAccountJson);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain a valid Firebase service-account JSON object');
  }
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key');
  }

  const app = getApps().find((candidate) => candidate.name === APP_NAME) ?? initializeApp(
    {
      credential: cert({ ...account, private_key: account.private_key.replace(/\\n/g, '\n') }),
      projectId: account.project_id,
    },
    APP_NAME,
  );
  messaging = getMessaging(app);
  return messaging;
}

export async function sendPushNotification(tokens, notification) {
  const client = getMessagingClient();
  if (!client || tokens.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (let offset = 0; offset < tokens.length; offset += 500) {
    const batch = tokens.slice(offset, offset + 500);
    const result = await client.sendEachForMulticast({
      tokens: batch.map(({ token }) => token),
      notification: { title: notification.title, body: notification.body },
      data: { notificationId: String(notification._id), link: notification.link || '' },
      android: { priority: 'high', notification: { channelId: 'aread-notifications' } },
    });

    sent += result.successCount;
    failed += result.failureCount;
    const invalidTokens = result.responses.flatMap((response, index) =>
      response.error && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(response.error.code)
        ? [batch[index].token]
        : [],
    );
    if (invalidTokens.length) await PushToken.deleteMany({ token: { $in: invalidTokens } });
  }
  return { sent, failed };
}
