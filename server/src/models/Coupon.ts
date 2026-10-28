import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const couponSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 30 },
    description: { type: String, default: '', maxlength: 200 },
    type: { type: String, enum: ['percent', 'flat'], required: true },
    /** Percentage (e.g. 10) for percent coupons, paise for flat coupons. */
    value: { type: Number, required: true, min: 0 },
    /** "order" discounts the cart subtotal; "making" discounts only the making charges in the cart. */
    scope: { type: String, enum: ['order', 'making'], default: 'order' },
    maxDiscount: { type: Number, default: 0, min: 0 },
    minSubtotal: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    usageLimit: { type: Number, default: 0, min: 0 },
    perCustomerLimit: { type: Number, default: 1, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    firstOrderOnly: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

couponSchema.index({ code: 1 }, { unique: true });

export type CouponShape = InferSchemaType<typeof couponSchema>;
export type CouponDoc = HydratedDocument<CouponShape>;
export const Coupon = model('Coupon', couponSchema);

const redemptionSchema = new Schema(
  {
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    email: { type: String, required: true, lowercase: true },
    phone: { type: String, default: '' },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    discount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

redemptionSchema.index({ coupon: 1, order: 1 }, { unique: true });
redemptionSchema.index({ coupon: 1, email: 1 });
redemptionSchema.index({ coupon: 1, phone: 1 });

export const CouponRedemption = model('CouponRedemption', redemptionSchema);
