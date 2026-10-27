import mongoose from '../config/mongoose.js';

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    link: { type: String, trim: true, maxlength: 300, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

const notificationReadSchema = new mongoose.Schema(
  {
    notification: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
notificationReadSchema.index({ notification: 1, user: 1 }, { unique: true });

const pushTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: ['android', 'ios'], required: true },
  },
  { timestamps: true },
);
pushTokenSchema.index({ user: 1 });

export const Notification = mongoose.model('Notification', notificationSchema);
export const NotificationRead = mongoose.model('NotificationRead', notificationReadSchema);
export const PushToken = mongoose.model('PushToken', pushTokenSchema);
