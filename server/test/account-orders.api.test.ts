import { beforeAll, describe, expect, it } from 'vitest';
import type { MyOrdersResponse } from '@goldshop/shared';
import { Order } from '../src/models';
import { checkoutBody, createCategory, createProduct, createUser, seedSettings, signIn } from './helpers';

type Agent = Awaited<ReturnType<typeof signIn>>;
let shopper: Agent;
const placed: string[] = [];

beforeAll(async () => {
  await seedSettings();
  const rings = await createCategory('Rings');
  const band = await createProduct({ name: 'Plain Band', category: rings._id, purity: 'gold22', variants: [{ sku: 'PB-1', netWeightMg: 2000, stock: 5 }] });
  const temple = await createProduct({ name: 'Temple Ring', category: rings._id, purity: 'gold22', variants: [{ sku: 'TR-1', netWeightMg: 8000, stock: 5 }] });
  await createUser('customer', 'orders@example.com');
  await createUser('customer', 'someone-else@example.com');
  shopper = await signIn('orders@example.com');
  for (const p of [band, temple]) {
    await shopper.post('/api/cart/items').send({ productId: String(p._id), variantId: String(p.variants[0]._id), qty: 1 }).expect(201);
    const res = await shopper.post('/api/checkout').send(checkoutBody({ customer: { name: 'Orders Test', email: 'orders@example.com', phone: '9876543210' } })).expect(201);
    placed.push(res.body.orderNumber);
  }
});

const list = async (query = '') => (await shopper.get(`/api/account/orders${query}`).expect(200)).body as MyOrdersResponse;

describe('my orders', () => {
  it('lists orders with what is needed to show progress and buy again', async () => {
    const body = await list();
    expect(body.counts).toMatchObject({ all: 2, processing: 2, shipped: 0, delivered: 0, cancelled: 0 });
    const temple = body.items.find((o) => o.firstItem?.name === 'Temple Ring')!;
    expect(temple.firstItem).toMatchObject({ purity: 'gold22', netWeightMg: 8000 });
    expect(temple.progress?.placed).toBeTruthy();
    expect(temple.progress?.delivered).toBeUndefined();
    expect(temple.lines).toEqual([{ productId: expect.any(String), variantId: expect.any(String), qty: 1 }]);
  });

  it('groups by status and dates each stage from the order history', async () => {
    const shippedAt = new Date('2026-10-12T05:00:00Z');
    const deliveredAt = new Date('2026-10-14T05:00:00Z');
    await Order.updateOne(
      { orderNumber: placed[0] },
      {
        $set: { status: 'delivered' },
        $push: { statusHistory: { $each: [{ status: 'shipped', at: shippedAt }, { status: 'delivered', at: deliveredAt }] } },
      },
    );
    const delivered = await list('?status=delivered');
    expect(delivered.counts).toMatchObject({ all: 2, processing: 1, delivered: 1 });
    expect(delivered.items.map((o) => o.orderNumber)).toEqual([placed[0]]);
    expect(delivered.items[0].progress).toMatchObject({ shipped: shippedAt.toISOString(), delivered: deliveredAt.toISOString() });
    // Processing was skipped, so it has no date of its own.
    expect(delivered.items[0].progress?.processing).toBeUndefined();
  });

  it('searches by piece or order number and sorts by amount', async () => {
    expect((await list('?q=temple')).items.map((o) => o.firstItem?.name)).toEqual(['Temple Ring']);
    expect((await list(`?q=${placed[0].slice(-4)}`)).items.map((o) => o.orderNumber)).toEqual([placed[0]]);
    const asc = (await list('?sort=amount_asc')).items.map((o) => o.total);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    // Unknown values fall back to safe defaults rather than erroring.
    expect((await list('?status=everything&sort=nonsense')).total).toBe(2);
  });

  it('shows each customer only their own orders', async () => {
    const other = await signIn('someone-else@example.com');
    const body = (await other.get('/api/account/orders').expect(200)).body as MyOrdersResponse;
    expect(body.total).toBe(0);
    expect(body.counts.all).toBe(0);
  });
});
