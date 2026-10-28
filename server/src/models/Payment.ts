import { Schema, model } from 'mongoose';

/** One record per gateway payment attempt, keyed by the gateway's payment id. */
const paymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    provider: { type: String, enum: ['razorpay'], default: 'razorpay' },
    providerOrderId: { type: String, required: true },
    providerPaymentId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['authorized', 'captured', 'failed', 'refunded'], required: true },
    method: { type: String, default: '' },
    source: { type: String, enum: ['client_verify', 'webhook', 'admin'], required: true },
    errorDescription: { type: String, default: '' },
    refunds: {
      type: [{ refundId: String, amount: Number, status: String, at: Date, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);

paymentSchema.index({ providerPaymentId: 1 }, { unique: true });
paymentSchema.index({ order: 1, createdAt: -1 });

export const Payment = model('Payment', paymentSchema);
