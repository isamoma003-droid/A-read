import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

// One M-Pesa payment attempt. `purpose` says what it was for: "donation" today; other values
// (e.g. "premium") can later unlock features for `user` once `status` is "paid".
const paymentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    promotion: { type: Schema.Types.ObjectId, ref: 'Promotion', index: true },
    purpose: { type: String, trim: true, maxlength: 40, default: 'donation' },
    phone: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending', index: true },
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

// For unlocking paid features later: has this reader paid at least `minAmount` for `purpose`?
paymentSchema.statics.hasPaid = async function hasPaid(userId, purpose, minAmount = 1) {
  return Boolean(await this.exists({ user: userId, purpose, status: 'paid', amount: { $gte: minAmount } }));
};

export const Payment = mongoose.model('Payment', paymentSchema);
