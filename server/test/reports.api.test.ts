import { beforeAll, describe, expect, it } from 'vitest';
import { Order } from '../src/models';
import { agent, checkoutBody, createCategory, createProduct, createUser, seedSettings, signIn } from './helpers';

type Agent = Awaited<ReturnType<typeof signIn>>;
let admin: Agent;
const placed: string[] = [];

beforeAll(async () => {
  await seedSettings();
  const rings = await createCategory('Rings');
  const chains = await createCategory('Chains');
  const band = await createProduct({ name: 'Plain Band', category: rings._id, purity: 'gold22', variants: [{ sku: 'PB-1', netWeightMg: 2000, stock: 5 }] });
  const chain = await createProduct({ name: 'Rope Chain', category: chains._id, purity: 'gold18', variants: [{ sku: 'RC-1', netWeightMg: 6000, stock: 5 }] });
  await createProduct({ name: 'Unsold Pendant', category: chains._id, purity: 'gold22', variants: [{ sku: 'UP-1', netWeightMg: 3000, stock: 2 }] });
  await createUser('admin', 'admin@example.com');
  await createUser('staff', 'staff@example.com');
  await createUser('customer', 'returning@example.com');
  admin = await signIn('admin@example.com');

  const buy = async (shopper: Agent, productId: string, variantId: string, email: string, name: string) => {
    await shopper.post('/api/cart/items').send({ productId, variantId, qty: 1 }).expect(201);
    const res = await shopper.post('/api/checkout').send(checkoutBody({ customer: { name, email, phone: '9876543210' } })).expect(201);
    placed.push(res.body.orderNumber);
  };
  // A registered customer who bought twice, and a guest who bought once.
  const member = await signIn('returning@example.com');
  await buy(member, String(band._id), String(band.variants[0]._id), 'returning@example.com', 'Lakshmi');
  await buy(member, String(chain._id), String(chain.variants[0]._id), 'returning@example.com', 'Lakshmi');
  await buy(agent(), String(band._id), String(band.variants[0]._id), 'guest@example.com', 'Arun');
  // The member's first order was 40 days ago: they count as returning, and it falls in the previous 30 days.
  // (Through the raw collection: Mongoose treats createdAt as immutable.)
  await Order.collection.updateOne({ orderNumber: placed[0] }, { $set: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
});

describe('dashboard', () => {
  it('compares each period with the one before and lists top products', async () => {
    const d = (await admin.get('/api/admin/dashboard').expect(200)).body;
    expect(d.series).toHaveLength(90);
    expect(d.last30.orders).toBe(2);
    expect(d.prev30.orders).toBe(1);
    expect(d.today.orders).toBe(2);
    expect(d.yesterday.orders).toBe(0);
    expect(d.toFulfil).toBe(3);
    expect(d.oldestOpenAt).toBeTruthy();
    expect(d.topProducts.map((p: { name: string }) => p.name).sort()).toEqual(['Plain Band', 'Rope Chain']);
    expect(d.recentOrders[0]).toHaveProperty('customerName');
  });
});

describe('product and customer reports', () => {
  it('reports sales by product and purity, and the live pieces that did not sell', async () => {
    const r = (await admin.get('/api/admin/reports/products').expect(200)).body;
    expect(r.totals).toMatchObject({ units: 2, productsSold: 2, live: 3 });
    expect(r.totals.avgPrice % 100).toBe(0);
    expect(r.byPurity.map((p: { purity: string }) => p.purity).sort()).toEqual(['gold18', 'gold22']);
    expect(r.unsold.map((p: { name: string }) => p.name)).toEqual(['Unsold Pendant']);
  });

  it('separates first-time from returning buyers and guests from account holders', async () => {
    const r = (await admin.get('/api/admin/reports/customers').expect(200)).body;
    expect(r.totals).toMatchObject({ customers: 2, newCustomers: 1, returningCustomers: 1, registered: 1, guests: 1, orders: 2 });
    const member = r.topCustomers.find((c: { email: string }) => c.email === 'returning@example.com');
    expect(member).toMatchObject({ returning: true, orders: 1, userId: expect.any(String) });
    expect(r.byState[0]).toMatchObject({ state: 'Tamil Nadu', customers: 2 });
  });

  it('keeps reports admin-only', async () => {
    const staff = await signIn('staff@example.com');
    await staff.get('/api/admin/reports/products').expect(403);
    await staff.get('/api/admin/reports/customers').expect(403);
  });
});
