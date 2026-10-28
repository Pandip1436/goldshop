import { Types } from 'mongoose';
import { formatINR, roundToRupee, type CouponState } from '@goldshop/shared';
import { Coupon, CouponRedemption, Order, type CouponShape } from '../models';

export interface CouponContext {
  subtotal: number;
  /** Sum of (making − making discount) × qty across weight-priced lines. */
  makingTotal: number;
  email?: string;
  phone?: string;
  userId?: string;
  now?: Date;
}

export type CouponEvaluation = CouponState & { couponId?: Types.ObjectId };

type CouponPricing = Pick<CouponShape, 'type' | 'value' | 'scope' | 'maxDiscount'>;

/** Pure discount maths. Discounts round down to the rupee and never exceed what they apply to. */
export function computeCouponDiscount(coupon: CouponPricing, subtotal: number, makingTotal: number): number {
  const base = coupon.scope === 'making' ? makingTotal : subtotal;
  if (base <= 0) return 0;
  let discount = coupon.type === 'percent' ? (base * Math.min(coupon.value, 100)) / 100 : coupon.value;
  if (coupon.maxDiscount && coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.min(discount, base, subtotal);
  return Math.floor(discount / 100) * 100;
}

export function describeCoupon(c: CouponPricing & { description?: string | null }): string {
  if (c.description) return c.description;
  const what = c.scope === 'making' ? 'making charges' : 'your order';
  return c.type === 'percent' ? `${c.value}% off ${what}` : `${formatINR(c.value)} off ${what}`;
}

const COUNTED_STATUSES = ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

export async function evaluateCoupon(rawCode: string, ctx: CouponContext): Promise<CouponEvaluation> {
  const code = rawCode.trim().toUpperCase();
  const invalid = (message: string): CouponEvaluation => ({ code, valid: false, discount: 0, message });
  const coupon = await Coupon.findOne({ code }).lean();
  if (!coupon || !coupon.isActive) return invalid("This code isn't valid.");

  const now = ctx.now ?? new Date();
  if (coupon.startsAt && coupon.startsAt > now) return invalid("This code isn't active yet.");
  if (coupon.endsAt && coupon.endsAt < now) return invalid('This code has expired.');
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) return invalid('This code has been fully redeemed.');
  if (coupon.minSubtotal > 0 && ctx.subtotal < coupon.minSubtotal) {
    return invalid(`Add ${formatINR(roundToRupee(coupon.minSubtotal - ctx.subtotal))} more to use this code.`);
  }

  const identity = [
    ...(ctx.email ? [{ email: ctx.email.toLowerCase() }] : []),
    ...(ctx.phone ? [{ phone: ctx.phone }] : []),
    ...(ctx.userId ? [{ user: new Types.ObjectId(ctx.userId) }] : []),
  ];

  if (coupon.firstOrderOnly && identity.length) {
    const orderIdentity = [
      ...(ctx.email ? [{ 'customer.email': ctx.email.toLowerCase() }] : []),
      ...(ctx.phone ? [{ 'customer.phone': ctx.phone }] : []),
      ...(ctx.userId ? [{ user: new Types.ObjectId(ctx.userId) }] : []),
    ];
    const previous = await Order.exists({ $or: orderIdentity, status: { $in: COUNTED_STATUSES } });
    if (previous) return invalid('This code is for first orders only.');
  }

  if (coupon.perCustomerLimit > 0 && identity.length) {
    const used = await CouponRedemption.countDocuments({ coupon: coupon._id, $or: identity });
    if (used >= coupon.perCustomerLimit) return invalid("You've already used this code.");
  }

  const discount = computeCouponDiscount(coupon, ctx.subtotal, ctx.makingTotal);
  if (discount <= 0) {
    return invalid(
      coupon.scope === 'making'
        ? "This code applies to making charges, and the items in your bag don't have any."
        : "This code doesn't apply to your bag.",
    );
  }

  return {
    code,
    valid: true,
    discount,
    description: describeCoupon(coupon),
    message: coupon.firstOrderOnly && !identity.length ? 'First-order code: we confirm eligibility at checkout.' : undefined,
    couponId: coupon._id,
  };
}

/**
 * Records a redemption once an order is confirmed. The usage counter is incremented atomically;
 * the unique (coupon, order) index makes this safe to call more than once.
 */
export async function redeemCoupon(order: {
  _id: Types.ObjectId;
  coupon?: { couponId?: Types.ObjectId; discount: number } | null;
  customer: { email: string; phone: string };
  user?: Types.ObjectId | null;
}): Promise<void> {
  const couponId = order.coupon?.couponId;
  if (!couponId) return;
  try {
    await CouponRedemption.create({
      coupon: couponId,
      order: order._id,
      email: order.customer.email,
      phone: order.customer.phone,
      user: order.user ?? null,
      discount: order.coupon?.discount ?? 0,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return; // already redeemed for this order
    throw err;
  }
  await Coupon.updateOne({ _id: couponId }, { $inc: { usedCount: 1 } });
}
