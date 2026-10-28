import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CartDTO, CheckoutResponse, OrderDTO } from '@goldshop/shared';
import { Coupon, CouponRedemption, InventoryLog, Order, Product } from '../src/models';
import { testOutbox } from '../src/services/mailer';
import { ADDRESS_KA, agent, checkoutBody, createCategory, createProduct, seedSettings, setSettings } from './helpers';
import type { Types } from 'mongoose';

let category: Types.ObjectId;

beforeAll(async () => {
  category = (await createCategory('Earrings'))._id;
});

beforeEach(async () => {
  await Product.deleteMany({});
  await Order.deleteMany({});
  await Coupon.deleteMany({});
  await CouponRedemption.deleteMany({});
  await seedSettings();
  testOutbox.length = 0;
});

async function product(stock = 3, netWeightMg = 4000) {
  const p = await createProduct({ name: `Jhumka ${Math.random().toString(36).slice(2, 7)}`, category, purity: 'gold22', variants: [{ sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, netWeightMg, stock }] });
  return { productId: String(p._id), variantId: String(p.variants[0]._id), doc: p };
}

describe('cart', () => {
  it('creates a guest cart via cookie and prices it on the server', async () => {
    const a = agent();
    const { productId, variantId } = await product();
    const res = await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    expect(res.headers['set-cookie']?.[0]).toMatch(/gs_cart=.*HttpOnly/i);
    const cart = res.body.cart as CartDTO;
    expect(cart.itemCount).toBe(1);
    expect(cart.subtotal).toBe(cart.lines[0].unitPrice);
    // The server ignores any price the browser might try to send.
    const again = await a.post('/api/cart/items').send({ productId, variantId, qty: 1, price: 1 }).expect(201);
    expect(again.body.cart.lines[0].unitPrice).toBe(cart.lines[0].unitPrice);
  });

  it('caps quantity at available stock', async () => {
    const a = agent();
    const { productId, variantId } = await product(2);
    const res = await a.post('/api/cart/items').send({ productId, variantId, qty: 5 }).expect(201);
    expect(res.body.cart.lines[0].qty).toBe(2);
    expect(res.body.message).toMatch(/Only 2 available/);
  });

  it('refuses sold-out items', async () => {
    const { productId, variantId } = await product(0);
    const res = await agent().post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(409);
    expect(res.body.error.code).toBe('out_of_stock');
  });

  it('tells the shopper when the gold rate changed the price', async () => {
    const a = agent();
    const { productId, variantId } = await product();
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    await setSettings({ 'goldRates.gold22': 1_200_000 });
    const cart = (await a.get('/api/cart').expect(200)).body as CartDTO;
    expect(cart.lines[0].issue).toMatch(/Price increased/);
    // Acknowledged once; the next view is quiet.
    const again = (await a.get('/api/cart').expect(200)).body as CartDTO;
    expect(again.lines[0].issue).toBeUndefined();
  });

  it('updates and removes lines', async () => {
    const a = agent();
    const { productId, variantId } = await product(5);
    const add = await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const lineId = add.body.cart.lines[0].id;
    const upd = await a.patch(`/api/cart/items/${lineId}`).send({ qty: 3 }).expect(200);
    expect(upd.body.cart.itemCount).toBe(3);
    const del = await a.delete(`/api/cart/items/${lineId}`).expect(200);
    expect(del.body.cart.lines).toHaveLength(0);
  });

  it('quotes shipping by PIN code', async () => {
    const a = agent();
    const { productId, variantId } = await product(1, 1000);
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const tn = (await a.get('/api/cart?pincode=600004').expect(200)).body as CartDTO;
    expect(tn.shipping?.serviceable).toBe(true);
    expect(tn.shipping?.amount).toBe(0);
    const ka = (await a.get('/api/cart?pincode=560001').expect(200)).body as CartDTO;
    expect(ka.shipping?.amount).toBe(25_000);
    expect(ka.total).toBe(ka.subtotal + 25_000);
  });
});

describe('coupons', () => {
  it('applies a valid code and rejects an expired one', async () => {
    const a = agent();
    const { productId, variantId } = await product();
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    await Coupon.create({ code: 'MAKING20', type: 'percent', value: 20, scope: 'making' });
    await Coupon.create({ code: 'OLD', type: 'flat', value: 50_000, endsAt: new Date(Date.now() - 86400_000) });

    const bad = await a.post('/api/cart/coupon').send({ code: 'old' }).expect(400);
    expect(bad.body.error.message).toMatch(/expired/);

    const ok = await a.post('/api/cart/coupon').send({ code: 'making20' }).expect(200);
    const cart = ok.body.cart as CartDTO;
    expect(cart.coupon?.valid).toBe(true);
    expect(cart.discount).toBeGreaterThan(0);
    expect(cart.total).toBe(cart.subtotal - cart.discount);
  });

  it('enforces minimum order value', async () => {
    const a = agent();
    const { productId, variantId } = await product(1, 500);
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    await Coupon.create({ code: 'BIG', type: 'flat', value: 100_000, minSubtotal: 50_000_000 });
    const res = await a.post('/api/cart/coupon').send({ code: 'BIG' }).expect(400);
    expect(res.body.error.message).toMatch(/Add .* more/);
  });
});

describe('checkout (cash on delivery)', () => {
  it('places an order: reserves stock, confirms, redeems the coupon, clears the cart and emails the customer', async () => {
    const a = agent();
    const { productId, variantId } = await product(3);
    await Coupon.create({ code: 'WELCOME', type: 'flat', value: 50_000, perCustomerLimit: 1 });
    await a.post('/api/cart/items').send({ productId, variantId, qty: 2 }).expect(201);
    await a.post('/api/cart/coupon').send({ code: 'WELCOME' }).expect(200);
    const quote = (await a.get('/api/cart?pincode=600004&paymentMethod=cod').expect(200)).body as CartDTO;

    const res = await a.post('/api/checkout').send(checkoutBody({ expectedTotal: quote.total })).expect(201);
    const body = res.body as CheckoutResponse;
    expect(body.status).toBe('confirmed');

    const order = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    expect(order?.pricing.total).toBe(quote.total);
    expect(order?.pricing.discount).toBe(50_000);
    expect(order?.customer.phone).toBe('9876543210'); // normalised from "+91 98765 43210"
    expect(order?.pricing.cgst).toBeGreaterThan(0); // Tamil Nadu → Tamil Nadu is intra-state
    expect(order?.invoiceNumber).toMatch(/^TS\/\d{4}-\d{2}\/00001$/);
    // Seller details are frozen onto the order so later settings edits never alter the invoice.
    expect(order?.seller?.name).toBe('Test Jewellers');
    expect(order?.seller?.address?.state).toBe('Tamil Nadu');

    const p = await Product.findById(productId).lean();
    expect(p?.variants[0].stock).toBe(1);
    expect(p?.soldCount).toBe(2);
    expect(await InventoryLog.countDocuments({ order: order?._id, reason: 'order' })).toBe(1);

    const coupon = await Coupon.findOne({ code: 'WELCOME' }).lean();
    expect(coupon?.usedCount).toBe(1);
    expect((await a.get('/api/cart').expect(200)).body.lines).toHaveLength(0);
    expect(testOutbox.some((m) => m.to === 'priya@example.com' && m.subject.includes(body.orderNumber))).toBe(true);

    // The guest can view their order with the access token, and nobody else can.
    const view = (await a.get(`/api/orders/${body.orderNumber}?token=${body.accessToken}`).expect(200)).body as OrderDTO;
    expect(view.items[0].qty).toBe(2);
    await agent().get(`/api/orders/${body.orderNumber}`).expect(404);
    await agent().get(`/api/orders/${body.orderNumber}?token=wrong`).expect(404);

    // The same customer can't reuse a one-per-customer coupon.
    const b = agent();
    await b.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    await b.post('/api/cart/coupon').send({ code: 'WELCOME' }).expect(200);
    const second = await b.post('/api/checkout').send(checkoutBody()).expect(409);
    expect(second.body.error.code).toBe('coupon_invalid');
  });

  it('refuses to place the order if the total changed since the customer saw it', async () => {
    const a = agent();
    const { productId, variantId } = await product();
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const quote = (await a.get('/api/cart?pincode=600004').expect(200)).body as CartDTO;
    await setSettings({ 'goldRates.gold22': 1_250_000 });
    await a.get('/api/cart').expect(200); // shopper sees and acknowledges the new price
    const res = await a.post('/api/checkout').send(checkoutBody({ expectedTotal: quote.total })).expect(409);
    expect(res.body.error.code).toBe('total_changed');
    expect(res.body.error.details.cart.total).toBeGreaterThan(quote.total);
    expect(await Order.countDocuments()).toBe(0);
  });

  it('sells the last piece only once when two shoppers check out together', async () => {
    const { productId, variantId } = await product(1);
    const a = agent();
    const b = agent();
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    await b.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const [r1, r2] = await Promise.all([
      a.post('/api/checkout').send(checkoutBody()),
      b.post('/api/checkout').send(checkoutBody({ customer: { name: 'Second Buyer', email: 'b@example.com', phone: '9123456780' } })),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const p = await Product.findById(productId).lean();
    expect(p?.variants[0].stock).toBe(0);
    expect(p?.inStock).toBe(false);
    expect(await Order.countDocuments({ status: 'confirmed' })).toBe(1);
  });

  it('validates Indian address fields with helpful messages', async () => {
    const a = agent();
    const { productId, variantId } = await product();
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const res = await a
      .post('/api/checkout')
      .send(checkoutBody({ address: { ...checkoutBody().address, pincode: '012345', phone: '12345' } }))
      .expect(400);
    expect(res.body.error.fields['address.pincode']).toMatch(/6-digit PIN/);
    expect(res.body.error.fields['address.phone']).toMatch(/10-digit/);
  });

  it('blocks COD where it is not offered and destinations that are not serviceable', async () => {
    const a = agent();
    const { productId, variantId } = await product();
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const cod = await a.post('/api/checkout').send(checkoutBody({ address: ADDRESS_KA })).expect(422);
    expect(cod.body.error.code).toBe('cod_unavailable');

    await setSettings({ 'shipping.fallbackEnabled': false });
    const ship = await a.post('/api/checkout').send(checkoutBody({ address: ADDRESS_KA })).expect(422);
    expect(ship.body.error.code).toBe('not_serviceable');
  });

  it('enforces the COD order limit', async () => {
    await setSettings({ 'checkout.codMaxOrderValue': 1_000_000 });
    const a = agent();
    const { productId, variantId } = await product(2, 5000);
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const res = await a.post('/api/checkout').send(checkoutBody()).expect(422);
    expect(res.body.error.code).toBe('cod_limit');
  });

  it('lets a COD customer cancel before processing, restoring stock', async () => {
    const a = agent();
    const { productId, variantId } = await product(2);
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const placed = (await a.post('/api/checkout').send(checkoutBody()).expect(201)).body as CheckoutResponse;
    const res = await a.post(`/api/orders/${placed.orderNumber}/cancel`).send({ token: placed.accessToken }).expect(200);
    expect(res.body.status).toBe('cancelled');
    expect((await Product.findById(productId).lean())?.variants[0].stock).toBe(2);
    // Cancelling twice is refused and does not restock twice.
    await a.post(`/api/orders/${placed.orderNumber}/cancel`).send({ token: placed.accessToken }).expect(409);
    expect((await Product.findById(productId).lean())?.variants[0].stock).toBe(2);
  });

  it('tracks an order by number and contact without exposing the address', async () => {
    const a = agent();
    const { productId, variantId } = await product();
    await a.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const placed = (await a.post('/api/checkout').send(checkoutBody()).expect(201)).body as CheckoutResponse;
    const res = await agent().post('/api/orders/track').send({ orderNumber: placed.orderNumber.toLowerCase(), contact: '98765 43210' }).expect(200);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.shippingAddress).toBeUndefined();
    await agent().post('/api/orders/track').send({ orderNumber: placed.orderNumber, contact: 'someone@else.com' }).expect(404);
  });
});
