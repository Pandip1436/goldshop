import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PURITY_KEYS,
  type ImageRef,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type PriceBreakdown,
  type PurityKey,
} from '@goldshop/shared';
import { addressFields, imageSchema } from './common';

export interface IOrderItem {
  product: Types.ObjectId;
  variant: Types.ObjectId;
  slug: string;
  name: string;
  variantLabel: string;
  sku: string;
  image?: ImageRef;
  purity?: PurityKey;
  netWeightMg?: number;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  breakdown: PriceBreakdown;
}

export interface IOrder {
  orderNumber: string;
  user?: Types.ObjectId | null;
  accessTokenHash: string;
  customer: { name: string; email: string; phone: string };
  shippingAddress: {
    fullName: string;
    phone: string;
    line1: string;
    line2: string;
    landmark: string;
    city: string;
    state: string;
    pincode: string;
  };
  gstin: string;
  /** Seller details as they were when the order was placed, so invoices never change retroactively. */
  seller?: { name: string; legalName: string; gstin: string; phone: string; email: string; hsnCode: string; address: { line1: string; line2: string; city: string; state: string; pincode: string } };
  items: IOrderItem[];
  pricing: {
    subtotal: number;
    discount: number;
    shipping: number;
    codFee: number;
    total: number;
    taxableValue: number;
    gstAmount: number;
    gstRateBps: number;
    cgst: number;
    sgst: number;
    igst: number;
  };
  coupon?: { code: string; discount: number; couponId?: Types.ObjectId } | null;
  goldRates: Partial<Record<PurityKey, number>>;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    paidAt?: Date;
    amountPaid: number;
    amountRefunded: number;
  };
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: Date; note?: string; by?: string }[];
  shipment?: {
    carrier?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    shippedAt?: Date;
    deliveredAt?: Date;
  };
  zoneName: string;
  /** The guest cart that placed the order, so its items can be cleared when payment lands. */
  cartGuestToken?: string;
  /** Stock bookkeeping flags make reserve/release idempotent. */
  stockReserved: boolean;
  stockReleased: boolean;
  couponRedeemed: boolean;
  soldCounted: boolean;
  /** False until every post-confirmation side effect has run; a sweeper retries stragglers. */
  effectsApplied: boolean;
  /** Unpaid online orders release their stock after this time. */
  reservationExpiresAt?: Date | null;
  invoiceNumber?: string;
  notes: string;
  adminNotes: string;
  marketingConsent: boolean;
  confirmationEmailSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variant: { type: Schema.Types.ObjectId, required: true },
    slug: String,
    name: { type: String, required: true },
    variantLabel: { type: String, default: '' },
    sku: { type: String, default: '' },
    image: { type: imageSchema },
    purity: { type: String, enum: PURITY_KEYS },
    netWeightMg: Number,
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    breakdown: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    accessTokenHash: { type: String, required: true, select: false },
    customer: {
      name: { type: String, required: true },
      email: { type: String, required: true, lowercase: true },
      phone: { type: String, required: true },
    },
    shippingAddress: addressFields,
    gstin: { type: String, default: '' },
    seller: { type: Schema.Types.Mixed },
    items: { type: [orderItemSchema], required: true },
    pricing: {
      subtotal: { type: Number, required: true },
      discount: { type: Number, default: 0 },
      shipping: { type: Number, default: 0 },
      codFee: { type: Number, default: 0 },
      total: { type: Number, required: true },
      taxableValue: { type: Number, default: 0 },
      gstAmount: { type: Number, default: 0 },
      gstRateBps: { type: Number, default: 0 },
      cgst: { type: Number, default: 0 },
      sgst: { type: Number, default: 0 },
      igst: { type: Number, default: 0 },
    },
    coupon: {
      type: new Schema(
        { code: String, discount: Number, couponId: { type: Schema.Types.ObjectId, ref: 'Coupon' } },
        { _id: false },
      ),
      default: null,
    },
    goldRates: { type: Schema.Types.Mixed, default: {} },
    payment: {
      method: { type: String, enum: PAYMENT_METHODS, required: true },
      status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
      razorpayOrderId: { type: String },
      razorpayPaymentId: { type: String },
      paidAt: Date,
      amountPaid: { type: Number, default: 0 },
      amountRefunded: { type: Number, default: 0 },
    },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending_payment' },
    statusHistory: {
      type: [{ status: { type: String, enum: ORDER_STATUSES }, at: Date, note: String, by: String, _id: false }],
      default: [],
    },
    shipment: {
      carrier: String,
      trackingNumber: String,
      trackingUrl: String,
      shippedAt: Date,
      deliveredAt: Date,
    },
    zoneName: { type: String, default: '' },
    cartGuestToken: { type: String, select: false },
    stockReserved: { type: Boolean, default: false },
    stockReleased: { type: Boolean, default: false },
    couponRedeemed: { type: Boolean, default: false },
    soldCounted: { type: Boolean, default: false },
    effectsApplied: { type: Boolean, default: false },
    reservationExpiresAt: { type: Date, default: null },
    invoiceNumber: { type: String },
    notes: { type: String, default: '', maxlength: 500 },
    adminNotes: { type: String, default: '', maxlength: 4000 },
    marketingConsent: { type: Boolean, default: false },
    confirmationEmailSent: { type: Boolean, default: false },
  },
  { timestamps: true },
);

orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'customer.email': 1, createdAt: -1 });
orderSchema.index({ 'customer.phone': 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index(
  { 'payment.razorpayOrderId': 1 },
  { unique: true, partialFilterExpression: { 'payment.razorpayOrderId': { $type: 'string' } } },
);
orderSchema.index({ invoiceNumber: 1 }, { unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string' } } });
orderSchema.index(
  { reservationExpiresAt: 1 },
  { partialFilterExpression: { status: 'pending_payment' } },
);
orderSchema.index({ effectsApplied: 1, updatedAt: 1 }, { partialFilterExpression: { effectsApplied: false } });

export type OrderDoc = HydratedDocument<IOrder>;
export const Order = model<IOrder>('Order', orderSchema);
