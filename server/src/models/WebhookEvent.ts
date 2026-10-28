import { Schema, model } from 'mongoose';

/**
 * Every webhook delivery is recorded by the gateway's event id before it is processed.
 * The unique index makes duplicate deliveries (which gateways send routinely) a no-op.
 */
const webhookEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    status: { type: String, enum: ['processing', 'processed', 'ignored', 'failed'], default: 'processing' },
    error: { type: String, default: '' },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 120 });

export const WebhookEvent = model('WebhookEvent', webhookEventSchema);
