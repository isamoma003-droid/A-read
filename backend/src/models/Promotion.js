import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// A "support us" popup that admins schedule. It never appears inside the reader, and readers can always close it.
const promotionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, trim: true, maxlength: 1000, default: '' },
    buttonLabel: { type: String, trim: true, maxlength: 40, default: 'Support us' },
    // Suggested amounts in KES, shown as quick picks.
    amounts: { type: [Number], default: [50, 100, 500] },
    purpose: { type: String, trim: true, maxlength: 40, default: 'donation' },
    audience: { type: String, enum: ['everyone', 'users', 'guests'], default: 'everyone' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    // Optional daily hours (HH:MM, in env.timeZone). dailyTo earlier than dailyFrom wraps past midnight.
    dailyFrom: { type: String, match: TIME },
    dailyTo: { type: String, match: TIME },
    // Close the popup by itself after this many seconds; 0 keeps it until the reader closes it.
    autoCloseSeconds: { type: Number, min: 0, max: 600, default: 0 },
    // How often one reader sees it: every page visit, once per browser session, once a day, or once.
    frequency: { type: String, enum: ['visit', 'session', 'day', 'once'], default: 'session' },
    // Seconds after the page opens before the popup appears.
    delaySeconds: { type: Number, min: 0, max: 300, default: 5 },
    paused: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

promotionSchema.index({ startsAt: 1, endsAt: 1 });

export const Promotion = mongoose.model('Promotion', promotionSchema);
