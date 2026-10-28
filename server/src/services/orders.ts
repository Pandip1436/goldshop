import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  formatINR,
  type checkoutSchema,
  type CheckoutResponse,
  type OrderDTO,
  type OrderStatus,
  type OrderSummaryDTO,
} from '@goldshop/shared';
import { env } from '../config/env';
import { randomCode, randomToken, sha256 } from '../lib/crypto';
import { AppError, conflict, unauthorized, unprocessable } from '../lib/errors';
import { logger } from '../lib/logger';
import { nextSequence, Order, Payment, Product, User, type IOrder, type OrderDoc } from '../models';
import type { AuthUser } from '../middleware/auth';
import { evaluateCart, findCart, removePurchasedFromCart, type CartOwner } from './cart';
import { redeemCoupon } from './coupons';
import { refreshStockFlags, releaseOrderStock, rereserveOrderStock, reserveStock } from './inventory';
import { notifyOrderConfirmed, notifyOrderStatus } from './notifications';
import { splitGst } from './pricing';
import { gateway } from './razorpay';
import { getSettings } from './settings';

export type CheckoutPayload = z.output<typeof checkoutSchema>;

const ACTIVE_STATUSES: OrderStatus[] = ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

/* ------------------------------------------------------------------ helpers */

function istDateParts(d = new Date()) {
  const [y, m, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d)
    .split('-');
  return { y, m, day };
}

/** Indian financial year label (April–March), e.g. "2026-27". */
export function financialYear(d = new Date()): string {
  const { y, m } = istDateParts(d);
  const year = Number(y);
  const start = Number(m) >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function newOrderNumber(prefix: string): string {
  const { y, m, day } = istDateParts();
  return `${prefix.toUpperCase()}${y.slice(2)}${m}${day}-${randomCode(4)}`;
}

/** Atomically moves an order between statuses; returns null if it was not in an allowed state. */
export async function transitionStatus(
  orderId: Types.ObjectId,
  from: OrderStatus[],
  to: OrderStatus,
  note: string,
  by?: string,
  extraSet: Record<string, unknown> = {},
): Promise<OrderDoc | null> {
  return Order.findOneAndUpdate(
    { _id: orderId, status: { $in: from } },
    {
      $set: { status: to, ...extraSet },
      $push: { statusHistory: { status: to, at: new Date(), note, by } },
    },
    { new: true },
  );
}

export function canAccessOrder(
  order: Pick<IOrder, 'user'> & { accessTokenHash?: string },
  user: AuthUser | undefined,
  token: string | undefined,
): boolean {
  if (user && order.user && String(order.user) === user.id) return true;
  // Staff can open any order (e.g. the printable invoice) — they already hold orders:read.
  if (user && (user.role === 'admin' || user.role === 'staff')) return true;
  if (token && order.accessTokenHash && sha256(token) === order.accessTokenHash) return true;
  return false;
}

/* ------------------------------------------------------------- place order */

export async function placeOrder(
  input: CheckoutPayload,
  ctx: { owner: CartOwner; user?: AuthUser },
): Promise<CheckoutResponse> {
  const settings = await getSettings({ fresh: true });
  if (!settings.checkout?.guestCheckout && !ctx.user) throw unauthorized('Please sign in to check out.');

  const cart = await findCart(ctx.owner);
  if (!cart || cart.items.length === 0) throw conflict('Your bag is empty.', 'cart_empty');

  const evaluation = await evaluateCart(cart, {
    pincode: input.address.pincode,
    state: input.address.state,
    paymentMethod: input.paymentMethod,
    email: input.customer.email,
    phone: input.customer.phone,
    userId: ctx.user?.id,
    persist: true,
    freshSettings: true,
  });
  const { view, lines, coupon, shipping } = evaluation;

  if (evaluation.changed) {
    throw conflict('Some items in your bag changed. Please review it before placing the order.', 'cart_changed', { cart: view });
  }
  if (!lines.length) throw conflict('Your bag is empty.', 'cart_empty');
  if (cart.couponCode && coupon && !coupon.valid) {
    throw conflict(coupon.message ?? 'Your coupon can no longer be applied.', 'coupon_invalid', { cart: view });
  }
  if (!shipping?.serviceable) {
    throw unprocessable(shipping?.message ?? "We can't deliver to this address yet.", 'not_serviceable');
  }

  if (input.paymentMethod === 'razorpay' && !env.razorpay.enabled) {
    throw unprocessable('Online payment is not available right now. Please choose another method.', 'payment_unavailable');
  }
  if (input.paymentMethod === 'cod') {
    if (!settings.checkout?.codEnabled || !shipping.codAvailable) {
      throw unprocessable('Cash on delivery is not available for this address.', 'cod_unavailable');
    }
    const max = settings.checkout.codMaxOrderValue ?? 0;
    if (max > 0 && view.total > max) {
      throw unprocessable(`Cash on delivery is available on orders up to ${formatINR(max)}.`, 'cod_limit');
    }
  }
  if (input.expectedTotal !== undefined && input.expectedTotal !== view.total) {
    throw conflict(
      `Your total is now ${formatINR(view.total)} (it was ${formatINR(input.expectedTotal)}). Please review and confirm.`,
      'total_changed',
      { cart: view },
    );
  }

  const gstBps = settings.tax?.gstRateBps ?? 300;
  const gst = splitGst(view.total, gstBps, settings.store?.address?.state ?? '', input.address.state);
  const accessToken = randomToken(24);
  const orderId = new Types.ObjectId();

  // Reserve stock first: this is the step that can legitimately fail under contention.
  await reserveStock(
    lines.map((l) => ({ product: l.product._id, variant: l.variant._id, sku: l.variant.sku, qty: l.qty, name: l.product.name })),
    orderId,
  );

  const isCod = input.paymentMethod === 'cod';
  let order: OrderDoc | null = null;
  try {
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      try {
        order = await Order.create({
          _id: orderId,
          orderNumber: newOrderNumber(settings.checkout?.orderPrefix || 'OR'),
          user: ctx.user ? new Types.ObjectId(ctx.user.id) : null,
          accessTokenHash: sha256(accessToken),
          customer: input.customer,
          shippingAddress: input.address,
          gstin: input.gstin ?? '',
          seller: {
            name: settings.store?.name ?? '',
            legalName: settings.store?.legalName ?? '',
            gstin: settings.store?.gstin ?? '',
            phone: settings.store?.phone ?? '',
            email: settings.store?.email ?? '',
            hsnCode: settings.tax?.hsnCode ?? '7113',
            address: settings.store?.address ?? { line1: '', line2: '', city: '', state: '', pincode: '' },
          },
          items: lines.map((l) => ({
            product: l.product._id,
            variant: l.variant._id,
            slug: l.product.slug,
            name: l.product.name,
            variantLabel: l.product.variants.filter((v) => v.isActive).length > 1 ? l.variant.label : '',
            sku: l.variant.sku,
            image: l.product.images?.[0],
            purity: l.product.purity,
            netWeightMg: l.variant.netWeightMg || undefined,
            qty: l.qty,
            unitPrice: l.price.total,
            lineTotal: l.lineTotal,
            breakdown: l.price,
          })),
          pricing: {
            subtotal: view.subtotal,
            discount: view.discount,
            shipping: shipping.amount,
            codFee: view.codFee,
            total: view.total,
            taxableValue: gst.taxableValue,
            gstAmount: gst.gstAmount,
            gstRateBps: gstBps,
            cgst: gst.cgst,
            sgst: gst.sgst,
            igst: gst.igst,
          },
          coupon: coupon?.valid ? { code: coupon.code, discount: coupon.discount, couponId: coupon.couponId } : null,
          goldRates: Object.fromEntries(
            Object.entries(settings.goldRates ?? {}).filter(([k, v]) => typeof v === 'number' && v > 0 && k !== 'updatedAt'),
          ),
          payment: { method: input.paymentMethod, status: 'pending', amountPaid: 0, amountRefunded: 0 },
          status: 'pending_payment',
          statusHistory: [{ status: 'pending_payment', at: new Date(), note: isCod ? 'Order placed' : 'Awaiting payment' }],
          zoneName: shipping.zoneName ?? '',
          cartGuestToken: ctx.owner.userId ? undefined : ctx.owner.guestToken,
          stockReserved: true,
          reservationExpiresAt: isCod ? null : new Date(Date.now() + env.reservationMinutes * 60_000),
          notes: input.notes ?? '',
          marketingConsent: Boolean(input.marketingConsent),
        });
      } catch (err) {
        if ((err as { code?: number; keyPattern?: Record<string, unknown> }).code === 11000 &&
            (err as { keyPattern?: Record<string, unknown> }).keyPattern?.orderNumber) continue;
        throw err;
      }
    }
    if (!order) throw new Error('Could not allocate an order number');
  } catch (err) {
    await releaseUnsavedReservation(lines.map((l) => ({ product: l.product._id, variant: l.variant._id, qty: l.qty })), orderId);
    throw err;
  }

  if (input.saveAddress && ctx.user) await saveAddressForUser(ctx.user.id, input.address).catch(() => undefined);
  if (input.marketingConsent && ctx.user) {
    await User.updateOne({ _id: ctx.user.id }, { $set: { 'marketingConsent.email': true, 'marketingConsent.updatedAt': new Date() } });
  }

  if (isCod) {
    await transitionStatus(order._id, ['pending_payment'], 'confirmed', 'Cash on delivery order confirmed');
    await applyConfirmationEffects(order._id);
    return { orderNumber: order.orderNumber, accessToken, status: 'confirmed' };
  }

  // Online payment: create the gateway order. If that fails, undo everything.
  try {
    const gwOrder = await gateway().createOrder({
      amount: view.total,
      receipt: order.orderNumber,
      notes: { orderNumber: order.orderNumber },
    });
    if (gwOrder.amount !== view.total) throw new AppError(502, 'gateway_error', 'Payment amount mismatch.');
    await Order.updateOne({ _id: order._id }, { $set: { 'payment.razorpayOrderId': gwOrder.id } });
    return {
      orderNumber: order.orderNumber,
      accessToken,
      status: 'pending_payment',
      payment: {
        provider: 'razorpay',
        keyId: env.razorpay.keyId,
        razorpayOrderId: gwOrder.id,
        amount: view.total,
        currency: 'INR',
        name: settings.store?.name ?? 'Store',
        description: `Order ${order.orderNumber}`,
        prefill: { name: input.customer.name, email: input.customer.email, contact: `+91${input.customer.phone}` },
      },
    };
  } catch (err) {
    logger.error({ err, orderNumber: order.orderNumber }, 'Could not create payment order; cancelling');
    await transitionStatus(order._id, ['pending_payment'], 'cancelled', 'Payment gateway unavailable', 'system');
    await releaseOrderStock(order._id, 'order_cancelled');
    throw err instanceof AppError
      ? err
      : new AppError(502, 'gateway_error', 'We could not start the payment. Please try again in a moment.');
  }
}

/** Puts stock back when the order document itself could not be written. */
async function releaseUnsavedReservation(
  lines: { product: Types.ObjectId; variant: Types.ObjectId; qty: number }[],
  orderId: Types.ObjectId,
) {
  const exists = await Order.exists({ _id: orderId });
  if (exists) {
    await releaseOrderStock(orderId, 'order_cancelled');
    return;
  }
  for (const l of lines) {
    await Product.updateOne(
      { _id: l.product, 'variants._id': l.variant },
      { $inc: { 'variants.$.stock': l.qty, totalStock: l.qty } },
    );
  }
  await refreshStockFlags(lines.map((l) => l.product));
}

async function saveAddressForUser(userId: string, address: CheckoutPayload['address']) {
  const user = await User.findById(userId).select('addresses');
  if (!user) return;
  const duplicate = user.addresses.some(
    (a) => a.line1 === address.line1 && a.pincode === address.pincode && a.fullName === address.fullName,
  );
  if (duplicate || user.addresses.length >= 10) return;
  user.addresses.push({ ...address, label: 'Home', isDefault: user.addresses.length === 0 });
  await user.save();
}

/* -------------------------------------------------------- payment capture */

export interface CapturedPayment {
  gatewayOrderId: string;
  paymentId: string;
  amount: number;
  method?: string;
  source: 'client_verify' | 'webhook' | 'admin';
}

/**
 * Marks an order paid exactly once, however many times the gateway (or the browser) tells us.
 * Safe to call concurrently from the verify endpoint, the webhook and the reconciliation job.
 */
export async function recordCapturedPayment(p: CapturedPayment): Promise<OrderDoc | null> {
  const order = await Order.findOne({ 'payment.razorpayOrderId': p.gatewayOrderId });
  if (!order) {
    logger.warn({ gatewayOrderId: p.gatewayOrderId }, 'Captured payment for unknown order');
    return null;
  }

  try {
    await Payment.updateOne(
      { providerPaymentId: p.paymentId },
      {
        $setOnInsert: {
          order: order._id,
          orderNumber: order.orderNumber,
          providerOrderId: p.gatewayOrderId,
          providerPaymentId: p.paymentId,
          amount: p.amount,
          source: p.source,
        },
        $set: { status: 'captured', method: p.method ?? '' },
      },
      { upsert: true },
    );
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }

  if (p.amount !== order.pricing.total) {
    logger.error({ orderNumber: order.orderNumber, paid: p.amount, expected: order.pricing.total }, 'Payment amount mismatch');
    await transitionStatus(order._id, ['pending_payment', 'cancelled'], 'payment_review',
      `Payment of ${formatINR(p.amount)} does not match order total ${formatINR(order.pricing.total)}`, 'system');
    return Order.findById(order._id);
  }

  const paid = await Order.findOneAndUpdate(
    { _id: order._id, 'payment.status': { $ne: 'paid' } },
    {
      $set: {
        'payment.status': 'paid',
        'payment.razorpayPaymentId': p.paymentId,
        'payment.paidAt': new Date(),
        'payment.amountPaid': p.amount,
        reservationExpiresAt: null,
      },
    },
    { new: true },
  );
  if (!paid) return Order.findById(order._id); // already processed — idempotent no-op

  const via = p.method ? ` (${p.method.toUpperCase()})` : '';
  if (paid.status === 'pending_payment') {
    await transitionStatus(paid._id, ['pending_payment'], 'confirmed', `Payment received${via}`, 'system');
  } else if (paid.status === 'cancelled') {
    // The reservation lapsed before the payment arrived. Try to take the stock again.
    const ok = paid.stockReleased ? await rereserveOrderStock(paid._id) : true;
    if (ok) {
      await transitionStatus(paid._id, ['cancelled'], 'confirmed', `Late payment received${via}; order reinstated`, 'system');
    } else {
      await transitionStatus(paid._id, ['cancelled'], 'payment_review',
        'Payment received after reservation expired and stock is no longer available. Refund or fulfil manually.', 'system');
      return Order.findById(paid._id);
    }
  }
  await applyConfirmationEffects(paid._id);
  return Order.findById(paid._id);
}

/* ---------------------------------------------------- confirmation effects */

/**
 * Side effects of a confirmed order. Each step is guarded by its own flag so the whole function
 * can safely be re-run (the sweeper retries orders where it did not finish).
 */
export async function applyConfirmationEffects(orderId: Types.ObjectId): Promise<void> {
  try {
    const order = await Order.findById(orderId).select('+cartGuestToken');
    if (!order || !ACTIVE_STATUSES.includes(order.status)) return;

    if (!order.couponRedeemed && order.coupon?.couponId) {
      const r = await Order.updateOne({ _id: orderId, couponRedeemed: false }, { $set: { couponRedeemed: true } });
      if (r.modifiedCount) await redeemCoupon(order);
    }

    if (!order.soldCounted) {
      const r = await Order.updateOne({ _id: orderId, soldCounted: false }, { $set: { soldCounted: true } });
      if (r.modifiedCount) {
        await Product.bulkWrite(
          order.items.map((i) => ({ updateOne: { filter: { _id: i.product }, update: { $inc: { soldCount: i.qty } } } })),
          { ordered: false },
        );
        if (order.user) {
          await User.updateOne({ _id: order.user }, { $inc: { orderCount: 1, totalSpent: order.pricing.total } });
        }
      }
    }

    if (!order.invoiceNumber) {
      const settings = await getSettings();
      const fy = financialYear(order.createdAt);
      const seq = await nextSequence(`invoice:${fy}`);
      const prefix = (settings.checkout?.orderPrefix || 'INV').toUpperCase();
      await Order.updateOne(
        { _id: orderId, invoiceNumber: { $exists: false } },
        { $set: { invoiceNumber: `${prefix}/${fy}/${String(seq).padStart(5, '0')}` } },
      );
    }

    const owner: CartOwner = order.user ? { userId: String(order.user) } : { guestToken: order.cartGuestToken };
    if (owner.userId || owner.guestToken) {
      await removePurchasedFromCart(owner, order.items.map((i) => ({ variant: i.variant, qty: i.qty })));
    }

    if (!order.confirmationEmailSent) {
      const r = await Order.updateOne({ _id: orderId, confirmationEmailSent: false }, { $set: { confirmationEmailSent: true } });
      if (r.modifiedCount) await notifyOrderConfirmed(await Order.findById(orderId).lean<IOrder & { _id: Types.ObjectId }>());
    }

    await Order.updateOne({ _id: orderId }, { $set: { effectsApplied: true } });
  } catch (err) {
    logger.error({ err, orderId: String(orderId) }, 'Order confirmation effects failed; will retry');
  }
}

/* ------------------------------------------------------------ cancellation */

export async function cancelOrder(
  orderId: Types.ObjectId,
  opts: { note: string; by: string; notify?: boolean },
): Promise<OrderDoc> {
  const updated = await transitionStatus(
    orderId,
    ['pending_payment', 'confirmed', 'processing', 'payment_review'],
    'cancelled',
    opts.note,
    opts.by,
    { reservationExpiresAt: null },
  );
  if (!updated) throw conflict('This order can no longer be cancelled.', 'invalid_transition');
  await releaseOrderStock(orderId, 'order_cancelled');
  if (opts.notify !== false) await notifyOrderStatus(updated.toObject(), 'cancelled').catch(() => undefined);
  return updated;
}

/* --------------------------------------------------------------- sweepers */

/**
 * Cancels unpaid online orders whose reservation has lapsed, returning their stock — but first
 * asks the gateway whether a payment actually went through (in case a webhook was missed).
 */
export async function expireStaleReservations(limit = 50): Promise<number> {
  const stale = await Order.find({ status: 'pending_payment', reservationExpiresAt: { $lt: new Date() } })
    .select('_id orderNumber payment pricing')
    .limit(limit)
    .lean();
  let expired = 0;
  for (const o of stale) {
    if (env.razorpay.enabled && o.payment?.razorpayOrderId) {
      try {
        const payments = await gateway().fetchOrderPayments(o.payment.razorpayOrderId);
        const captured = payments.find((p) => p.status === 'captured');
        const authorized = payments.find((p) => p.status === 'authorized');
        const winner = captured ?? (authorized ? await gateway().capturePayment(authorized.id, authorized.amount) : undefined);
        if (winner && winner.status === 'captured') {
          await recordCapturedPayment({
            gatewayOrderId: o.payment.razorpayOrderId,
            paymentId: winner.id,
            amount: winner.amount,
            method: winner.method,
            source: 'admin',
          });
          continue;
        }
      } catch (err) {
        logger.warn({ err, orderNumber: o.orderNumber }, 'Could not reconcile payment before expiry; will retry');
        continue; // don't cancel while the gateway is unreachable
      }
    }
    const t = await transitionStatus(o._id, ['pending_payment'], 'cancelled', 'Payment was not completed in time', 'system', {
      reservationExpiresAt: null,
    });
    if (t) {
      await releaseOrderStock(o._id, 'reservation_expired');
      expired++;
    }
  }
  return expired;
}

export async function retryPendingEffects(limit = 25): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 60_000);
  const pending = await Order.find({ effectsApplied: false, status: { $in: ACTIVE_STATUSES }, updatedAt: { $lt: cutoff } })
    .select('_id')
    .limit(limit)
    .lean();
  for (const o of pending) await applyConfirmationEffects(o._id);
}

/* ---------------------------------------------------------------- mapping */

type OrderLike = IOrder & { _id: Types.ObjectId };

export function toOrderDTO(o: OrderLike): OrderDTO {
  const reservationOpen = !o.reservationExpiresAt || new Date(o.reservationExpiresAt) > new Date();
  return {
    orderNumber: o.orderNumber,
    createdAt: new Date(o.createdAt).toISOString(),
    status: o.status,
    statusHistory: (o.statusHistory ?? []).map((h) => ({ status: h.status, at: new Date(h.at).toISOString(), note: h.note })),
    customer: o.customer,
    shippingAddress: {
      fullName: o.shippingAddress.fullName,
      phone: o.shippingAddress.phone,
      line1: o.shippingAddress.line1,
      line2: o.shippingAddress.line2 || undefined,
      landmark: o.shippingAddress.landmark || undefined,
      city: o.shippingAddress.city,
      state: o.shippingAddress.state,
      pincode: o.shippingAddress.pincode,
    },
    items: o.items.map((i) => ({
      productId: String(i.product),
      slug: i.slug,
      name: i.name,
      variantLabel: i.variantLabel,
      sku: i.sku,
      image: i.image?.key || i.image?.url ? i.image : undefined,
      purity: i.purity,
      netWeightMg: i.netWeightMg,
      qty: i.qty,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      breakdown: i.breakdown,
    })),
    pricing: o.pricing,
    coupon: o.coupon?.code ? { code: o.coupon.code, discount: o.coupon.discount } : undefined,
    payment: {
      method: o.payment.method,
      status: o.payment.status,
      paidAt: o.payment.paidAt ? new Date(o.payment.paidAt).toISOString() : undefined,
      reference: o.payment.razorpayPaymentId,
    },
    shipment: o.shipment?.carrier || o.shipment?.trackingNumber
      ? {
          carrier: o.shipment.carrier,
          trackingNumber: o.shipment.trackingNumber,
          trackingUrl: o.shipment.trackingUrl,
          shippedAt: o.shipment.shippedAt ? new Date(o.shipment.shippedAt).toISOString() : undefined,
          deliveredAt: o.shipment.deliveredAt ? new Date(o.shipment.deliveredAt).toISOString() : undefined,
        }
      : undefined,
    invoiceNumber: o.invoiceNumber,
    gstin: o.gstin || undefined,
    seller: o.seller,
    notes: o.notes || undefined,
    canCancel:
      o.status === 'pending_payment' ||
      (o.payment.method === 'cod' && o.status === 'confirmed'),
    canPay:
      o.status === 'pending_payment' &&
      o.payment.method === 'razorpay' &&
      Boolean(o.payment.razorpayOrderId) &&
      env.razorpay.enabled &&
      reservationOpen,
    goldRates: o.goldRates,
  };
}

export function toOrderSummary(o: OrderLike): OrderSummaryDTO {
  const iso = (d?: Date | string | null) => (d ? new Date(d).toISOString() : undefined);
  const reached = (...statuses: OrderStatus[]) => iso(o.statusHistory?.find((h) => statuses.includes(h.status))?.at);
  const first = o.items[0];
  return {
    orderNumber: o.orderNumber,
    createdAt: new Date(o.createdAt).toISOString(),
    status: o.status,
    total: o.pricing.total,
    itemCount: o.items.reduce((s, i) => s + i.qty, 0),
    firstItem: first
      ? { name: first.name, image: first.image, slug: first.slug, purity: first.purity, netWeightMg: first.netWeightMg, variantLabel: first.variantLabel || undefined }
      : undefined,
    paymentStatus: o.payment.status,
    progress: {
      placed: new Date(o.createdAt).toISOString(),
      processing: reached('processing'),
      shipped: reached('shipped', 'out_for_delivery') ?? iso(o.shipment?.shippedAt),
      delivered: reached('delivered') ?? iso(o.shipment?.deliveredAt),
      cancelled: reached('cancelled'),
      returned: reached('returned'),
    },
    trackingUrl: o.shipment?.trackingUrl || undefined,
    lines: o.items.map((i) => ({ productId: String(i.product), variantId: String(i.variant), qty: i.qty })),
  };
}
