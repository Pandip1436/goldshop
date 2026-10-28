import { Router } from 'express';
import type { FilterQuery } from 'mongoose';
import { z } from 'zod';
import { ORDER_STATUSES, ORDER_TRANSITIONS, ORDER_STATUS_LABELS, formatINR, normalizeIndianMobile, type OrderStatus } from '@goldshop/shared';
import { env } from '../../config/env';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { escapeRegex, paginated, pagination, parse } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { Order, Payment, type IOrder } from '../../models';
import { releaseOrderStock, rereserveOrderStock } from '../../services/inventory';
import { notifyOrderStatus } from '../../services/notifications';
import { applyConfirmationEffects, cancelOrder, toOrderDTO, transitionStatus } from '../../services/orders';
import { gateway } from '../../services/razorpay';
import { orderStatusInput, refundInput, shipmentInput } from './schemas';

export const adminOrdersRouter = Router();

function dateRange(from: unknown, to: unknown) {
  const range: Record<string, Date> = {};
  // Dates are entered as IST calendar days.
  if (typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from)) range.$gte = new Date(`${from}T00:00:00+05:30`);
  if (typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to)) range.$lte = new Date(`${to}T23:59:59.999+05:30`);
  return Object.keys(range).length ? range : undefined;
}

export function orderFilter(query: Record<string, unknown>): FilterQuery<IOrder> {
  const filter: FilterQuery<IOrder> = {};
  if (typeof query.status === 'string' && (ORDER_STATUSES as readonly string[]).includes(query.status)) filter.status = query.status;
  if (query.status === 'open') filter.status = { $in: ['confirmed', 'processing', 'payment_review'] };
  if (query.payment === 'razorpay' || query.payment === 'cod') filter['payment.method'] = query.payment;
  if (typeof query.paymentStatus === 'string') filter['payment.status'] = query.paymentStatus;
  const created = dateRange(query.from, query.to);
  if (created) filter.createdAt = created;
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '';
  if (q) {
    const phone = normalizeIndianMobile(q);
    filter.$or = [
      { orderNumber: q.toUpperCase() },
      { 'customer.email': q.toLowerCase() },
      ...(phone.length === 10 ? [{ 'customer.phone': phone }] : []),
      { 'customer.name': new RegExp(escapeRegex(q), 'i') },
    ];
  }
  return filter;
}

adminOrdersRouter.get('/orders', requirePermission('orders:read'), async (req, res) => {
  const { page, limit, skip } = pagination(req, 100, 25);
  const filter = orderFilter(req.query as Record<string, unknown>);
  const [items, total, counts] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .select('orderNumber createdAt status customer pricing.total payment.method payment.status items.qty items.name shippingAddress.city shippingAddress.state')
      .lean(),
    Order.countDocuments(filter),
    Order.aggregate<{ _id: OrderStatus; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  res.json({
    ...paginated(
      items.map((o) => ({
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        status: o.status,
        customer: o.customer,
        city: o.shippingAddress?.city,
        state: o.shippingAddress?.state,
        total: o.pricing.total,
        paymentMethod: o.payment.method,
        paymentStatus: o.payment.status,
        itemCount: o.items.reduce((s, i) => s + i.qty, 0),
        firstItem: o.items[0]?.name,
      })),
      total,
      page,
      limit,
    ),
    statusCounts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
  });
});

async function loadOrder(orderNumber: string) {
  const order = await Order.findOne({ orderNumber: orderNumber.toUpperCase() });
  if (!order) throw notFound('Order not found.');
  return order;
}

adminOrdersRouter.get('/orders/:orderNumber', requirePermission('orders:read'), async (req, res) => {
  const order = await loadOrder(String(req.params.orderNumber));
  const payments = await Payment.find({ order: order._id }).sort({ createdAt: -1 }).lean();
  const obj = order.toObject();
  res.json({
    ...toOrderDTO(obj),
    id: String(order._id),
    userId: order.user ? String(order.user) : undefined,
    adminNotes: order.adminNotes,
    zoneName: order.zoneName,
    reservationExpiresAt: order.reservationExpiresAt,
    allowedTransitions: ORDER_TRANSITIONS[order.status],
    stock: { reserved: order.stockReserved, released: order.stockReleased },
    payments: payments.map((p) => ({
      id: p.providerPaymentId,
      amount: p.amount,
      status: p.status,
      method: p.method,
      source: p.source,
      createdAt: p.createdAt,
      refunds: p.refunds,
      errorDescription: p.errorDescription || undefined,
    })),
    gatewayConfigured: env.razorpay.enabled,
  });
});

adminOrdersRouter.patch('/orders/:orderNumber/status', requirePermission('orders:write'), async (req, res) => {
  const input = parse(orderStatusInput, req.body);
  const order = await loadOrder(String(req.params.orderNumber));
  const allowed = ORDER_TRANSITIONS[order.status];
  if (!allowed.includes(input.status)) {
    throw conflict(`An order that is "${ORDER_STATUS_LABELS[order.status]}" cannot be moved to "${ORDER_STATUS_LABELS[input.status]}".`, 'invalid_transition');
  }
  const by = req.user!.email;
  const note = input.note || `Marked ${ORDER_STATUS_LABELS[input.status].toLowerCase()}`;

  if (input.status === 'cancelled') {
    await cancelOrder(order._id, { note, by, notify: input.notify });
  } else {
    if (input.status === 'confirmed' && order.status === 'payment_review') {
      if (order.stockReleased && !(await rereserveOrderStock(order._id))) {
        throw conflict('Not enough stock to confirm this order. Restock the items first or cancel and refund.');
      }
    }
    const extra: Record<string, unknown> = {};
    if (input.status === 'shipped') extra['shipment.shippedAt'] = new Date();
    if (input.status === 'delivered') extra['shipment.deliveredAt'] = new Date();
    if (input.status === 'delivered' && order.payment.method === 'cod' && order.payment.status === 'pending') {
      // Delivery of a COD order means cash was collected.
      Object.assign(extra, { 'payment.status': 'paid', 'payment.paidAt': new Date(), 'payment.amountPaid': order.pricing.total });
    }
    const updated = await transitionStatus(order._id, [order.status], input.status, note, by, extra);
    if (!updated) throw conflict('The order changed while you were editing. Refresh and try again.');
    if (input.status === 'returned' && input.restock) await releaseOrderStock(order._id, 'return');
    if (input.status === 'confirmed') await applyConfirmationEffects(order._id);
    if (input.notify) await notifyOrderStatus(updated.toObject(), input.status).catch(() => undefined);
  }
  const fresh = await Order.findById(order._id).lean();
  res.json(toOrderDTO(fresh!));
});

adminOrdersRouter.patch('/orders/:orderNumber/shipment', requirePermission('orders:write'), async (req, res) => {
  const input = parse(shipmentInput, req.body);
  const order = await loadOrder(String(req.params.orderNumber));
  order.set('shipment.carrier', input.carrier);
  order.set('shipment.trackingNumber', input.trackingNumber);
  order.set('shipment.trackingUrl', input.trackingUrl);
  await order.save();
  res.json(toOrderDTO(order.toObject()));
});

adminOrdersRouter.patch('/orders/:orderNumber/notes', requirePermission('orders:write'), async (req, res) => {
  const { adminNotes } = parse(z.object({ adminNotes: z.string().max(4000) }), req.body);
  const r = await Order.updateOne({ orderNumber: String(req.params.orderNumber).toUpperCase() }, { $set: { adminNotes } });
  if (!r.matchedCount) throw notFound();
  res.json({ ok: true });
});

/** Records cash collected for a COD order. */
adminOrdersRouter.post('/orders/:orderNumber/mark-paid', requirePermission('orders:write'), async (req, res) => {
  const order = await loadOrder(String(req.params.orderNumber));
  if (order.payment.method !== 'cod') throw badRequest('Only cash-on-delivery orders can be marked paid manually.');
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, 'payment.status': 'pending' },
    {
      $set: { 'payment.status': 'paid', 'payment.paidAt': new Date(), 'payment.amountPaid': order.pricing.total },
      $push: { statusHistory: { status: order.status, at: new Date(), note: 'Cash payment recorded', by: req.user!.email } },
    },
    { new: true },
  );
  if (!updated) throw conflict('This order is already marked paid.');
  res.json(toOrderDTO(updated.toObject()));
});

/**
 * Refunds an online payment through Razorpay (full or partial). The refund is recorded when
 * the gateway accepts it; the webhook later confirms when it is processed.
 */
adminOrdersRouter.post('/orders/:orderNumber/refund', requirePermission('orders:refund'), async (req, res) => {
  const input = parse(refundInput, req.body);
  const order = await loadOrder(String(req.params.orderNumber));
  const refundable = order.payment.amountPaid - order.payment.amountRefunded;
  if (refundable <= 0) throw badRequest('Nothing left to refund on this order.');
  if (input.amount > refundable) throw badRequest(`You can refund at most ${formatINR(refundable)}.`, { amount: 'Too high' });

  if (order.payment.method === 'razorpay') {
    if (!order.payment.razorpayPaymentId) throw badRequest('No captured payment found for this order.');
    const refund = await gateway().refund(order.payment.razorpayPaymentId, input.amount, {
      orderNumber: order.orderNumber,
      reason: input.reason,
    });
    await Payment.updateOne(
      { providerPaymentId: order.payment.razorpayPaymentId, 'refunds.refundId': { $ne: refund.id } },
      { $push: { refunds: { refundId: refund.id, amount: refund.amount, status: refund.status, at: new Date() } } },
    );
  }
  const refunded = order.payment.amountRefunded + input.amount;
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, 'payment.amountRefunded': order.payment.amountRefunded },
    {
      $set: {
        'payment.amountRefunded': refunded,
        'payment.status': refunded >= order.payment.amountPaid ? 'refunded' : 'partially_refunded',
      },
      $push: {
        statusHistory: {
          status: order.status,
          at: new Date(),
          note: `Refund of ${formatINR(input.amount)}${order.payment.method === 'cod' ? ' recorded (paid outside the gateway)' : ' issued via Razorpay'}${input.reason ? `: ${input.reason}` : ''}`,
          by: req.user!.email,
        },
      },
    },
    { new: true },
  );
  if (!updated) throw conflict('The order changed while you were editing. Refresh and try again.');
  res.json(toOrderDTO(updated.toObject()));
});
