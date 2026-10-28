import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Types } from 'mongoose';
import type { CheckoutResponse } from '@goldshop/shared';
import { Order, Payment, Product, WebhookEvent } from '../src/models';
import { expireStaleReservations } from '../src/services/orders';
import { setPaymentGateway } from '../src/services/razorpay';
import { agent, api, checkoutBody, checkoutSignature, createCategory, createProduct, fakeGateway, seedSettings, webhookSignature } from './helpers';

let fake: ReturnType<typeof fakeGateway>;
let category: Types.ObjectId;

beforeAll(async () => {
  category = (await createCategory('Rings'))._id;
});
afterAll(() => setPaymentGateway(null));

beforeEach(async () => {
  await Promise.all([Product.deleteMany({}), Order.deleteMany({}), Payment.deleteMany({}), WebhookEvent.deleteMany({})]);
  await seedSettings();
  fake = fakeGateway();
  setPaymentGateway(fake.gw);
});

async function placeOnlineOrder(stock = 2) {
  const p = await createProduct({ name: `Ring ${Math.random().toString(36).slice(2, 7)}`, category, purity: 'gold22', variants: [{ sku: `R-${Math.random().toString(36).slice(2, 8)}`, netWeightMg: 3000, stock }] });
  const a = agent();
  await a.post('/api/cart/items').send({ productId: String(p._id), variantId: String(p.variants[0]._id), qty: 1 }).expect(201);
  const res = await a.post('/api/checkout').send(checkoutBody({ paymentMethod: 'razorpay' })).expect(201);
  const body = res.body as CheckoutResponse;
  return { a, body, productId: p._id, rzpOrderId: body.payment!.razorpayOrderId, amount: body.payment!.amount };
}

function webhook(event: string, payment: { id: string; order_id: string; amount: number; status?: string }, eventId: string) {
  const raw = JSON.stringify({
    event,
    payload: { payment: { entity: { currency: 'INR', method: 'upi', status: 'captured', ...payment } } },
  });
  return api()
    .post('/api/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-event-id', eventId)
    .set('x-razorpay-signature', webhookSignature(raw))
    .send(raw);
}

describe('online payment', () => {
  it('creates a pending order and a gateway order for the exact server total', async () => {
    const { body, amount } = await placeOnlineOrder();
    expect(body.status).toBe('pending_payment');
    expect(body.payment?.keyId).toBe('rzp_test_dummykey');
    const order = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    expect(order?.pricing.total).toBe(amount);
    expect(order?.payment.status).toBe('pending');
    expect(order?.reservationExpiresAt).toBeTruthy();
    // The cart is kept until payment succeeds, in case the shopper abandons the payment window.
  });

  it('rejects a forged signature and leaves the order unpaid', async () => {
    const { a, body, rzpOrderId, amount } = await placeOnlineOrder();
    const paymentId = fake.pay(rzpOrderId, amount);
    const res = await a
      .post('/api/payments/razorpay/verify')
      .send({ orderNumber: body.orderNumber, token: body.accessToken, razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: 'f'.repeat(64) })
      .expect(400);
    expect(res.body.error.code).toBe('signature_invalid');
    expect((await Order.findOne({ orderNumber: body.orderNumber }).lean())?.payment.status).toBe('pending');
  });

  it('never marks an order paid just because the browser says so', async () => {
    const { a, body, rzpOrderId } = await placeOnlineOrder();
    // A validly signed id for a payment that Razorpay reports as failed.
    const paymentId = fake.pay(rzpOrderId, body.payment!.amount, 'failed');
    await a
      .post('/api/payments/razorpay/verify')
      .send({ orderNumber: body.orderNumber, token: body.accessToken, razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(rzpOrderId, paymentId) })
      .expect(409);
    expect((await Order.findOne({ orderNumber: body.orderNumber }).lean())?.status).toBe('pending_payment');
  });

  it('confirms on a verified payment, exactly once even if verified repeatedly', async () => {
    const { a, body, rzpOrderId, amount, productId } = await placeOnlineOrder();
    const paymentId = fake.pay(rzpOrderId, amount);
    const payload = { orderNumber: body.orderNumber, token: body.accessToken, razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(rzpOrderId, paymentId) };
    const [r1, r2] = await Promise.all([
      a.post('/api/payments/razorpay/verify').send(payload),
      a.post('/api/payments/razorpay/verify').send(payload),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const order = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    expect(order?.status).toBe('confirmed');
    expect(order?.payment.status).toBe('paid');
    expect(order?.payment.razorpayPaymentId).toBe(paymentId);
    expect(order?.statusHistory.filter((h) => h.status === 'confirmed')).toHaveLength(1);
    expect((await Product.findById(productId).lean())?.soldCount).toBe(1);
    expect(await Payment.countDocuments({ providerPaymentId: paymentId })).toBe(1);
    // The purchased item is now removed from the cart.
    expect((await a.get('/api/cart').expect(200)).body.lines).toHaveLength(0);
  });
});

describe('Razorpay webhook', () => {
  it('rejects requests without a valid signature', async () => {
    const raw = JSON.stringify({ event: 'payment.captured', payload: {} });
    await api().post('/api/payments/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', 'bad').send(raw).expect(400);
    await api().post('/api/payments/razorpay/webhook').set('Content-Type', 'application/json').send(raw).expect(400);
  });

  it('confirms the order and ignores duplicate deliveries of the same event', async () => {
    const { body, rzpOrderId, amount, productId } = await placeOnlineOrder();
    const paymentId = fake.pay(rzpOrderId, amount);
    const first = await webhook('payment.captured', { id: paymentId, order_id: rzpOrderId, amount }, 'evt_1').expect(200);
    expect(first.body.duplicate).toBeUndefined();
    const dup = await webhook('payment.captured', { id: paymentId, order_id: rzpOrderId, amount }, 'evt_1').expect(200);
    expect(dup.body.duplicate).toBe(true);
    // A different event for the same payment (order.paid) is also harmless.
    await webhook('order.paid', { id: paymentId, order_id: rzpOrderId, amount }, 'evt_2').expect(200);

    const order = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    expect(order?.status).toBe('confirmed');
    expect(order?.statusHistory.filter((h) => h.status === 'confirmed')).toHaveLength(1);
    expect((await Product.findById(productId).lean())?.soldCount).toBe(1);
    expect(await WebhookEvent.countDocuments()).toBe(2);
  });

  it('holds an order for review if the amount paid does not match', async () => {
    const { body, rzpOrderId, amount } = await placeOnlineOrder();
    const paymentId = fake.pay(rzpOrderId, amount - 100);
    await webhook('payment.captured', { id: paymentId, order_id: rzpOrderId, amount: amount - 100 }, 'evt_short').expect(200);
    const order = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    expect(order?.status).toBe('payment_review');
    expect(order?.payment.status).toBe('pending');
  });
});

describe('reservations', () => {
  it('releases stock when an online order is not paid in time, and reinstates it if payment arrives later', async () => {
    const { body, rzpOrderId, amount, productId } = await placeOnlineOrder(1);
    expect((await Product.findById(productId).lean())?.variants[0].stock).toBe(0);

    await Order.updateOne({ orderNumber: body.orderNumber }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    expect(await expireStaleReservations()).toBe(1);
    expect((await Order.findOne({ orderNumber: body.orderNumber }).lean())?.status).toBe('cancelled');
    expect((await Product.findById(productId).lean())?.variants[0].stock).toBe(1);
    // Running the sweeper again changes nothing.
    expect(await expireStaleReservations()).toBe(0);

    const paymentId = fake.pay(rzpOrderId, amount);
    await webhook('payment.captured', { id: paymentId, order_id: rzpOrderId, amount }, 'evt_late').expect(200);
    const order = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    expect(order?.status).toBe('confirmed');
    expect((await Product.findById(productId).lean())?.variants[0].stock).toBe(0);
  });

  it('does not cancel an order whose payment was captured but whose webhook was missed', async () => {
    const { body, rzpOrderId, amount } = await placeOnlineOrder();
    fake.pay(rzpOrderId, amount);
    await Order.updateOne({ orderNumber: body.orderNumber }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    await expireStaleReservations();
    expect((await Order.findOne({ orderNumber: body.orderNumber }).lean())?.status).toBe('confirmed');
  });

  it('cancels the order and restores stock if the gateway is unavailable', async () => {
    fake.state.failCreate = true;
    const p = await createProduct({ name: 'Gateway Ring', category, purity: 'gold22', variants: [{ sku: 'GW-1', netWeightMg: 3000, stock: 1 }] });
    const a = agent();
    await a.post('/api/cart/items').send({ productId: String(p._id), variantId: String(p.variants[0]._id), qty: 1 }).expect(201);
    const res = await a.post('/api/checkout').send(checkoutBody({ paymentMethod: 'razorpay' })).expect(502);
    expect(res.body.error.code).toBe('gateway_error');
    expect((await Product.findById(p._id).lean())?.variants[0].stock).toBe(1);
    expect((await Order.findOne().lean())?.status).toBe('cancelled');
  });
});
