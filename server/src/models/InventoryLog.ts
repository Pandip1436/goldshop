import { Schema, model } from 'mongoose';

const inventoryLogSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variant: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, default: '' },
    delta: { type: Number, required: true },
    stockAfter: { type: Number },
    reason: { type: String, enum: ['order', 'order_cancelled', 'reservation_expired', 'manual', 'return', 'initial'], required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    note: { type: String, default: '', maxlength: 300 },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

inventoryLogSchema.index({ product: 1, createdAt: -1 });
inventoryLogSchema.index({ createdAt: -1 });

export const InventoryLog = model('InventoryLog', inventoryLogSchema);
