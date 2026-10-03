import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

// One M-Pesa payment attempt. `purpose` says what it was for: "donation" by default, a popup's
// purpose (e.g. "premium"), "book" when it unlocks the premium `book` for `user` once paid, or
// "pass" when it buys `user` a Premium Pass of `days` days (every premium book).
// `provider` says who talked to Safaricom: ISA Tech Hub ("hub") or A-Read itself ("daraja").
const paymentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    promotion: { type: Schema.Types.ObjectId, ref: 'Promotion', index: true },
    book: { type: Schema.Types.ObjectId, ref: 'Book' },
    purpose: { type: String, trim: true, maxlength: 40, default: 'donation' },
    phone: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    // Premium Pass payments: how many days this payment buys (the price and length can change later).
    days: Number,
    // disputed: M-Pesa reported a different amount (Hub payments only); an admin looks at it.
    status: { type: String, enum: ['pending', 'paid', 'failed', 'disputed'], default: 'pending', index: true },
    provider: { type: String, enum: ['daraja', 'hub'], default: 'daraja' },
    // The payment's id at ISA Tech Hub.
    hubPaymentId: { type: String, unique: true, sparse: true },
    checkoutRequestId: { type: String, unique: true, sparse: true },
    merchantRequestId: String,
    receipt: { type: String, unique: true, sparse: true },
    resultCode: Number,
    resultDesc: String,
    paidAt: Date,
    // Last time we asked Daraja about a pending payment (the callback can get lost).
    checkedAt: Date,
  },
  { timestamps: true },
);

paymentSchema.index({ user: 1, purpose: 1, status: 1 });
paymentSchema.index({ book: 1, status: 1, user: 1 });
// At most one unlock payment waiting for M-Pesa per reader and book (no double charge).
paymentSchema.index(
  { user: 1, book: 1 },
  { unique: true, partialFilterExpression: { status: 'pending', book: { $exists: true } }, name: 'one_pending_unlock' },
);

// And at most one Premium Pass payment waiting per reader.
paymentSchema.index(
  { user: 1, purpose: 1 },
  { unique: true, partialFilterExpression: { status: 'pending', purpose: 'pass' }, name: 'one_pending_pass' },
);

// For unlocking paid features later: has this reader paid at least `minAmount` for `purpose`?
paymentSchema.statics.hasPaid = async function hasPaid(userId, purpose, minAmount = 1) {
  return Boolean(await this.exists({ user: userId, purpose, status: 'paid', amount: { $gte: minAmount } }));
};

export const Payment = mongoose.model('Payment', paymentSchema);
