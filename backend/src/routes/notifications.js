import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Notification, NotificationRead, PushToken } from '../models/Notification.js';
import { isPushConfigured, sendPushNotification } from '../services/pushNotifications.js';
import { notFound } from '../utils/httpError.js';

const router = Router();
const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const notificationFields = {
  title: z.string().trim().min(1, 'Enter a notification title').max(120),
  body: z.string().trim().min(1, 'Enter a notification message').max(1000),
  link: z.string().trim().max(300).refine((value) => !value || (value.startsWith('/') && !value.startsWith('//')), 'Use an in-app link beginning with /'),
};

const publicNotification = (notification, read = false) => ({
  id: String(notification._id),
  title: notification.title,
  body: notification.body,
  link: notification.link || '',
  createdAt: notification.createdAt,
  read,
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  const [notifications, total, readCount] = await Promise.all([
    Notification.find().sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments(),
    NotificationRead.countDocuments({ user: req.user._id }),
  ]);
  const readIds = await NotificationRead.find({ user: req.user._id, notification: { $in: notifications.map((item) => item._id) } })
    .distinct('notification');
  const read = new Set(readIds.map(String));
  res.json({
    notifications: notifications.map((item) => publicNotification(item, read.has(String(item._id)))),
    unreadCount: Math.max(0, total - readCount),
  });
});

router.patch('/:notificationId/read', validate(z.object({ notificationId: objectId }), 'params'), async (req, res) => {
  const notification = await Notification.findById(req.valid.params.notificationId).select('_id').lean();
  if (!notification) throw notFound('Notification not found');
  await NotificationRead.updateOne(
    { notification: notification._id, user: req.user._id },
    { $setOnInsert: { notification: notification._id, user: req.user._id } },
    { upsert: true },
  );
  res.json({ ok: true });
});

const deviceSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(['android', 'ios']),
});

router.post('/devices', validate(deviceSchema), async (req, res) => {
  const { token, platform } = req.valid.body;
  await PushToken.findOneAndUpdate(
    { token },
    { $set: { user: req.user._id, platform } },
    { upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );
  res.status(204).end();
});

router.delete('/devices', validate(z.object({ token: z.string().trim().min(20).max(4096) })), async (req, res) => {
  await PushToken.deleteOne({ token: req.valid.body.token, user: req.user._id });
  res.status(204).end();
});

router.use('/admin', requireAdmin);

router.get('/admin', async (_req, res) => {
  const [notifications, registeredDevices] = await Promise.all([
    Notification.find().sort({ createdAt: -1 }).limit(100).lean(),
    PushToken.countDocuments(),
  ]);
  res.json({
    notifications: notifications.map((item) => publicNotification(item)),
    pushConfigured: isPushConfigured(),
    registeredDevices,
  });
});

router.post('/admin', validate(z.object(notificationFields)), async (req, res) => {
  const notification = await Notification.create({ ...req.valid.body, createdBy: req.user._id });
  const tokens = await PushToken.find().select('token').lean();
  let push = { configured: isPushConfigured(), sent: 0, failed: 0 };
  if (push.configured && tokens.length) {
    try {
      const result = await sendPushNotification(tokens, notification);
      push = { ...push, ...result };
    } catch (error) {
      console.error('Could not send push notifications:', error.message);
      push = { ...push, failed: tokens.length, error: 'The notice was published, but push delivery failed. Check Firebase service-account configuration.' };
    }
  }
  res.status(201).json({ notification: publicNotification(notification), push });
});

router.delete('/admin/:notificationId', validate(z.object({ notificationId: objectId }), 'params'), async (req, res) => {
  const { notificationId } = req.valid.params;
  const result = await Notification.deleteOne({ _id: notificationId });
  if (!result.deletedCount) throw notFound('Notification not found');
  await NotificationRead.deleteMany({ notification: notificationId });
  res.status(204).end();
});

export default router;
