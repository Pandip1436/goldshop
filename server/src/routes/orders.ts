import express, { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { normalizeIndianMobile, trackOrderSchema, type RazorpayCheckoutPayload } from '@goldshop/shared';
import { env } from '../config/env';
import { badRequest, conflict, notFound } from '../lib/errors';
import { logger } from '../lib/logger';
import { parse } from '../lib/http';
import { lookupLimiter } from '../middleware/security';
import { Order, Payment, WebhookEvent, type IOrder } from '../models';
import { canAccessOrder, cancelOrder, recordCapturedPayment, toOrderDTO } from '../services/orders';
import { gateway, verifyCheckoutSignature, verifyWebhookSignature, type GatewayPayment } from '../services/razorpay';
import { getSettings } from '../services/settings';

export const ordersRouter = Router();

type LeanOrder = IOrder & { _id: Types.ObjectId; accessTokenHash: string };

function tokenFrom(req: express.Request): string | undefined {
  if (typeof req.query.token === 'string') return req.query.token;
  if (typeof req.body?.token === 'string') return req.body.token;
  return undefined;
}

async function loadAccessibleOrder(orderNumber: string, req: express.Request, token = tokenFrom(req)): Promise<LeanOrder> {
  const order = await Order.findOne({ orderNumber: orderNumber.toUpperCase() }).select('+accessTokenHash').lean<LeanOrder>();
  // Same response for "missing" and "not yours" so order numbers can't be probed.
  if (!order || !canAccessOrder(order, req.user, token)) throw notFound('Order not found.');
  return order;
}

ordersRouter.get('/orders/:orderNumber', async (req, res) => {
  const order = await loadAccessibleOrder(String(req.params.orderNumber), req);
  res.set('Cache-Control', 'no-store');
  res.json(toOrderDTO(order));
});

ordersRouter.post('/orders/track', lookupLimiter, async (req, res) => {
  const { orderNumber, contact } = parse(trackOrderSchema, req.body);
  const order = await Order.findOne({ orderNumber }).lean();
  const c = contact.trim().toLowerCase();
  const phone = normalizeIndianMobile(c);
  const matches = order && (order.customer.email === c || (phone.length === 10 && order.customer.phone === phone));
  if (!order || !matches) throw notFound("We couldn't find an order with those details. Check the order number and the email or mobile used at checkout.");
  const dto = toOrderDTO(order);
  // Tracking by order number + contact reveals progress but not the full address.
  res.json({
    orderNumber: dto.orderNumber,
    createdAt: dto.createdAt,
    status: dto.status,
    statusHistory: dto.statusHistory,
    shipment: dto.shipment,
    items: dto.items.map((i) => ({ name: i.name, variantLabel: i.variantLabel, qty: i.qty, image: i.image, slug: i.slug })),
    total: dto.pricing.total,
    payment: { method: dto.payment.method, status: dto.payment.status },
    city: order.shippingAddress.city,
  });
});

ordersRouter.post('/orders/:orderNumber/cancel', async (req, res) => {
  const order = await loadAccessibleOrder(String(req.params.orderNumber), req);
  if (!toOrderDTO(order).canCancel) throw conflict('This order can no longer be cancelled online. Please contact us.');
  const updated = await cancelOrder(order._id, {
    note: 'Cancelled by customer',
    by: req.user?.email ?? order.customer.email,
  });
  res.json(toOrderDTO(updated.toObject()));
});

/** Re-opens Razorpay Checkout for an unpaid order (e.g. after the customer closed the window). */
ordersRouter.post('/orders/:orderNumber/pay', async (req, res) => {
  const order = await loadAccessibleOrder(String(req.params.orderNumber), req);
  const dto = toOrderDTO(order);
  if (!dto.canPay || !order.payment.razorpayOrderId) throw conflict('This order is not awaiting payment.');
  const settings = await getSettings();
  const payload: RazorpayCheckoutPayload = {
    provider: 'razorpay',
    keyId: env.razorpay.keyId,
    razorpayOrderId: order.payment.razorpayOrderId,
    amount: order.pricing.total,
    currency: 'INR',
    name: settings.store?.name ?? 'Store',
    description: `Order ${order.orderNumber}`,
    prefill: { name: order.customer.name, email: order.customer.email, contact: `+91${order.customer.phone}` },
  };
  res.json(payload);
});

const verifySchema = z.object({
  orderNumber: z.string().min(4).max(40),
  token: z.string().max(200).optional(),
  razorpay_order_id: z.string().min(4).max(60),
  razorpay_payment_id: z.string().min(4).max(60),
  razorpay_signature: z.string().min(16).max(200),
});

/**
 * Called by the browser after Razorpay Checkout succeeds. The signature proves the payment ids
 * came from Razorpay; we then ask Razorpay for the payment itself before marking anything paid.
 */
ordersRouter.post('/payments/razorpay/verify', async (req, res) => {
  const input = parse(verifySchema, req.body);
  const order = await loadAccessibleOrder(input.orderNumber, req, input.token);
  if (order.payment.razorpayOrderId !== input.razorpay_order_id) throw badRequest('Payment does not belong to this order.');
  if (!verifyCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) {
    logger.warn({ orderNumber: order.orderNumber }, 'Invalid Razorpay checkout signature');
    throw badRequest('We could not verify this payment. If money was deducted, it will be confirmed automatically or refunded.', undefined, 'signature_invalid');
  }

  let payment: GatewayPayment = await gateway().fetchPayment(input.razorpay_payment_id);
  if (payment.order_id !== input.razorpay_order_id) throw badRequest('Payment does not belong to this order.');
  if (payment.status === 'authorized') payment = await gateway().capturePayment(payment.id, payment.amount);
  if (payment.status !== 'captured') {
    throw conflict('Your payment is still being processed. We will confirm your order as soon as it completes.', 'payment_pending');
  }

  const updated = await recordCapturedPayment({
    gatewayOrderId: payment.order_id,
    paymentId: payment.id,
    amount: payment.amount,
    method: payment.method,
    source: 'client_verify',
  });
  res.json(toOrderDTO(updated ? updated.toObject() : order));
});

/* ---------------------------------------------------------------- webhook */

interface RazorpayWebhook {
  event: string;
  payload: {
    payment?: { entity: GatewayPayment };
    order?: { entity: { id: string } };
    refund?: { entity: { id: string; payment_id: string; amount: number; status: string } };
  };
}

/** Mounted with a raw body parser: signatures are computed over the exact bytes received. */
export const webhookRouter = Router();

webhookRouter.post('/payments/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) {
    logger.warn('Rejected Razorpay webhook with invalid signature');
    return void res.status(400).json({ error: { code: 'signature_invalid', message: 'Invalid signature' } });
  }
  let body: RazorpayWebhook;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return void res.status(400).json({ error: { code: 'bad_request', message: 'Invalid JSON' } });
  }
  const eventId = req.get('x-razorpay-event-id') || `${body.event}:${body.payload?.payment?.entity?.id ?? body.payload?.refund?.entity?.id ?? 'unknown'}`;

  // Claim the event. A duplicate delivery hits the unique index and is acknowledged untouched;
  // a previously failed event is re-claimed and retried.
  try {
    await WebhookEvent.create({ provider: 'razorpay', eventId, type: body.event, status: 'processing' });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const reclaimed = await WebhookEvent.findOneAndUpdate(
      { provider: 'razorpay', eventId, status: 'failed' },
      { $set: { status: 'processing', error: '' } },
    );
    if (!reclaimed) return void res.json({ ok: true, duplicate: true });
  }

  try {
    let handled = true;
    const payment = body.payload?.payment?.entity;
    switch (body.event) {
      case 'payment.captured':
      case 'order.paid':
        if (payment?.order_id && payment.status === 'captured') {
          await recordCapturedPayment({
            gatewayOrderId: payment.order_id,
            paymentId: payment.id,
            amount: payment.amount,
            method: payment.method,
            source: 'webhook',
          });
        }
        break;
      case 'payment.failed':
        if (payment?.order_id) {
          const order = await Order.findOne({ 'payment.razorpayOrderId': payment.order_id }).select('_id orderNumber').lean();
          if (order) {
            await Payment.updateOne(
              { providerPaymentId: payment.id },
              {
                $setOnInsert: {
                  order: order._id,
                  orderNumber: order.orderNumber,
                  providerOrderId: payment.order_id,
                  providerPaymentId: payment.id,
                  amount: payment.amount,
                  source: 'webhook',
                },
                $set: { status: 'failed', method: payment.method ?? '', errorDescription: payment.error_description ?? '' },
              },
              { upsert: true },
            );
          }
        }
        break;
      case 'refund.processed': {
        const refund = body.payload?.refund?.entity;
        if (refund) {
          const pay = await Payment.findOneAndUpdate(
            { providerPaymentId: refund.payment_id, 'refunds.refundId': { $ne: refund.id } },
            { $push: { refunds: { refundId: refund.id, amount: refund.amount, status: refund.status, at: new Date() } } },
            { new: true },
          );
          if (pay) {
            const refunded = pay.refunds.reduce((s, r) => s + (r.amount ?? 0), 0);
            await Order.updateOne(
              { _id: pay.order },
              {
                $set: {
                  'payment.amountRefunded': refunded,
                  'payment.status': refunded >= pay.amount ? 'refunded' : 'partially_refunded',
                },
              },
            );
          }
        }
        break;
      }
      default:
        handled = false;
    }
    await WebhookEvent.updateOne({ provider: 'razorpay', eventId }, { $set: { status: handled ? 'processed' : 'ignored' } });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, eventId, event: body.event }, 'Webhook processing failed');
    await WebhookEvent.updateOne({ provider: 'razorpay', eventId }, { $set: { status: 'failed', error: String((err as Error).message).slice(0, 300) } });
    // A 5xx makes Razorpay retry later; the failed record is re-claimed on that retry.
    res.status(500).json({ error: { code: 'server_error', message: 'Processing failed' } });
  }
});
