import { beforeAll, describe, expect, it } from 'vitest';
import type { Types } from 'mongoose';
import { Order, Product, Settings, User } from '../src/models';
import { fillHighlights, invalidateSettings } from '../src/services/settings';
import { testOutbox } from '../src/services/mailer';
import { agent, api, checkoutBody, createCategory, createProduct, createUser, seedSettings, signIn } from './helpers';

let category: Types.ObjectId;

beforeAll(async () => {
  await seedSettings();
  category = (await createCategory('Chains'))._id;
  await createUser('admin', 'admin@example.com');
  await createUser('staff', 'staff@example.com');
  await createUser('customer', 'customer@example.com');
});

describe('authentication', () => {
  it('registers, signs in and out with an httpOnly session cookie', async () => {
    const a = agent();
    const reg = await a.post('/api/auth/register').send({ name: 'Meena', email: 'Meena@Example.com', password: 'longenough1' }).expect(201);
    expect(reg.headers['set-cookie']?.[0]).toMatch(/gs_session=.*HttpOnly/i);
    expect(reg.body.user.email).toBe('meena@example.com');
    expect((await a.get('/api/auth/me').expect(200)).body.user.role).toBe('customer');
    await a.post('/api/auth/logout').expect(200);
    expect((await a.get('/api/auth/me').expect(200)).body.user).toBeNull();
    await api().post('/api/auth/register').send({ name: 'Meena', email: 'meena@example.com', password: 'longenough1' }).expect(409);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await api().post('/api/auth/login').send({ email: 'customer@example.com', password: 'nope-nope' }).expect(401);
    const unknown = await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope' }).expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('resets a password by emailed link and signs out other sessions', async () => {
    const old = await signIn('customer@example.com');
    testOutbox.length = 0;
    await api().post('/api/auth/forgot-password').send({ email: 'customer@example.com' }).expect(200);
    await api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(200);
    expect(testOutbox).toHaveLength(1);
    const token = decodeURIComponent(testOutbox[0].text.match(/token=([^\s)]+)/)![1]);
    await api().post('/api/auth/reset-password').send({ token, password: 'brand-new-pass' }).expect(200);
    await api().post('/api/auth/reset-password').send({ token, password: 'another-pass1' }).expect(400);
    expect((await old.get('/api/auth/me').expect(200)).body.user).toBeNull();
    await signIn('customer@example.com', 'brand-new-pass');
    await User.updateOne({ email: 'customer@example.com' }, { $set: { passwordHash: (await User.findOne({ email: 'admin@example.com' }).select('+passwordHash'))!.passwordHash } });
  });

  it('merges a guest bag into the account on sign-in', async () => {
    const p = await createProduct({ name: 'Merge Chain', category, purity: 'gold22', variants: [{ sku: 'MC-1', netWeightMg: 5000, stock: 4 }] });
    const a = agent();
    await a.post('/api/cart/items').send({ productId: String(p._id), variantId: String(p.variants[0]._id), qty: 2 }).expect(201);
    await a.post('/api/auth/login').send({ email: 'staff@example.com', password: 'password123' }).expect(200);
    const cart = (await a.get('/api/cart').expect(200)).body;
    expect(cart.itemCount).toBe(2);
  });
});

describe('admin authorisation (server-side)', () => {
  it('rejects anonymous and customer access to every admin API', async () => {
    await api().get('/api/admin/dashboard').expect(401);
    await api().get('/api/admin/orders').expect(401);
    const customer = await signIn('customer@example.com');
    await customer.get('/api/admin/dashboard').expect(403);
    await customer.get('/api/admin/products').expect(403);
    await customer.put('/api/admin/gold-rates').send({ rates: { gold22: 1 } }).expect(403);
  });

  it('lets staff run the shop but keeps settings, coupons, refunds and staff management admin-only', async () => {
    const staff = await signIn('staff@example.com');
    await staff.get('/api/admin/dashboard').expect(200);
    await staff.get('/api/admin/orders').expect(200);
    await staff.patch('/api/admin/settings').send({ announcement: { enabled: true, text: 'Hi', href: '' } }).expect(403);
    await staff.post('/api/admin/coupons').send({ code: 'STAFF10', type: 'percent', value: 10 }).expect(403);
    await staff.get('/api/admin/staff').expect(403);
    await staff.get('/api/admin/reports/sales').expect(403);
    await staff.post('/api/admin/orders/XX-1/refund').send({ amount: 100 }).expect(403);
  });

  it('blocks state-changing requests from other origins (CSRF)', async () => {
    const admin = await signIn('admin@example.com');
    await admin.patch('/api/admin/settings').set('Origin', 'https://evil.example').send({}).expect(403);
    await admin.patch('/api/admin/settings').set('Origin', 'http://localhost:5173').send({}).expect(200);
  });
});

describe('admin operations', () => {
  it('re-prices every weight-based product when the gold rate changes', async () => {
    const admin = await signIn('admin@example.com');
    const p = await createProduct({ name: 'Rate Chain', category, purity: 'gold22', variants: [{ sku: 'RC-1', netWeightMg: 10_000, stock: 1 }] });
    const before = p.minPrice;
    const big = await admin.put('/api/admin/gold-rates').send({ rates: { gold22: 2_000_000 } }).expect(400);
    expect(big.body.error.code).toBe('confirm_large_change');
    const res = await admin.put('/api/admin/gold-rates').send({ rates: { gold22: 1_200_000 } }).expect(200);
    expect(res.body.productsRepriced).toBeGreaterThan(0);
    const after = (await Product.findById(p._id).lean())!.minPrice;
    expect(after).toBeGreaterThan(before);
    const pub = (await api().get(`/api/products/${p.slug}`).expect(200)).body;
    expect(pub.price).toBe(after);
  });

  it('validates product input and creates products with derived prices', async () => {
    const admin = await signIn('admin@example.com');
    const bad = await admin.post('/api/admin/products').send({ name: 'X', category: String(category), variants: [] }).expect(400);
    expect(bad.body.error.code).toBe('validation_error');
    const res = await admin
      .post('/api/admin/products')
      .send({
        name: 'Admin Made Chain',
        category: String(category),
        purity: 'gold22',
        pricingMode: 'weight',
        making: { type: 'percent', value: 10 },
        variants: [{ sku: 'amc-1', netWeightMg: 8000, stock: 2 }],
      })
      .expect(201);
    const p = await Product.findById(res.body.id).lean();
    expect(p?.minPrice).toBeGreaterThan(0);
    expect(p?.variants[0].sku).toBe('AMC-1');
    expect(p?.inStock).toBe(true);
  });

  it('does not overwrite stock from the product editor', async () => {
    const admin = await signIn('admin@example.com');
    const p = await createProduct({ name: 'Stock Guard', category, purity: 'gold22', variants: [{ sku: 'SG-1', netWeightMg: 2000, stock: 5 }] });
    const detail = (await admin.get(`/api/admin/products/${p._id}`).expect(200)).body;
    await admin
      .put(`/api/admin/products/${p._id}`)
      .send({ ...detail, category: String(detail.category), collections: [], variants: detail.variants.map((v: Record<string, unknown>) => ({ ...v, id: v.id, stock: 999 })) })
      .expect(200);
    expect((await Product.findById(p._id).lean())?.variants[0].stock).toBe(5);
    await admin.patch(`/api/admin/inventory/${p._id}/${p.variants[0]._id}`).send({ stock: 8, note: 'Restock' }).expect(200);
    expect((await Product.findById(p._id).lean())?.variants[0].stock).toBe(8);
  });

  it('enforces order status transitions and restocks on cancellation', async () => {
    const admin = await signIn('admin@example.com');
    const p = await createProduct({ name: 'Flow Chain', category, purity: 'gold22', variants: [{ sku: 'FC-1', netWeightMg: 2000, stock: 2 }] });
    const shopper = agent();
    await shopper.post('/api/cart/items').send({ productId: String(p._id), variantId: String(p.variants[0]._id), qty: 1 }).expect(201);
    const placed = (await shopper.post('/api/checkout').send(checkoutBody()).expect(201)).body;

    const invalid = await admin.patch(`/api/admin/orders/${placed.orderNumber}/status`).send({ status: 'delivered' }).expect(409);
    expect(invalid.body.error.code).toBe('invalid_transition');
    await admin.patch(`/api/admin/orders/${placed.orderNumber}/status`).send({ status: 'processing' }).expect(200);
    await admin.patch(`/api/admin/orders/${placed.orderNumber}/shipment`).send({ carrier: 'BlueDart', trackingNumber: 'BD123', trackingUrl: '' }).expect(200);
    await admin.patch(`/api/admin/orders/${placed.orderNumber}/status`).send({ status: 'shipped' }).expect(200);
    const delivered = await admin.patch(`/api/admin/orders/${placed.orderNumber}/status`).send({ status: 'delivered' }).expect(200);
    expect(delivered.body.payment.status).toBe('paid'); // COD collected on delivery
    expect(delivered.body.shipment.trackingNumber).toBe('BD123');

    const shopper2 = agent();
    await shopper2.post('/api/cart/items').send({ productId: String(p._id), variantId: String(p.variants[0]._id), qty: 1 }).expect(201);
    const placed2 = (await shopper2.post('/api/checkout').send(checkoutBody()).expect(201)).body;
    expect((await Product.findById(p._id).lean())?.variants[0].stock).toBe(0);
    await admin.patch(`/api/admin/orders/${placed2.orderNumber}/status`).send({ status: 'cancelled', note: 'Customer called' }).expect(200);
    expect((await Product.findById(p._id).lean())?.variants[0].stock).toBe(1);
    expect((await Order.findOne({ orderNumber: placed2.orderNumber }).lean())?.status).toBe('cancelled');
  });

  it('saves banner layouts and serves them on the home page', async () => {
    const admin = await signIn('admin@example.com');
    await admin
      .post('/api/admin/banners')
      .send({ title: 'Full width *test*', layout: 'full', theme: 'light', align: 'left', ctaHref: '/shop', points: 'Hallmarked gold\n\n Trusted \nThird\nFourth' })
      .expect(201);
    await admin.post('/api/admin/banners').send({ title: 'Bad link', ctaHref: 'javascript:alert(1)' }).expect(400);
    const home = await api().get('/api/home').expect(200);
    const banner = home.body.banners.find((b: { title: string }) => b.title === 'Full width *test*');
    expect(banner).toMatchObject({ layout: 'full', theme: 'light', points: ['Hallmarked gold', 'Trusted', 'Third'] });
  });

  it('shows the homepage circles the admin chose, in order, skipping any that would lead nowhere', async () => {
    const admin = await signIn('admin@example.com');
    const full = await createCategory('Mangalsutra');
    await createProduct({ name: 'Thali Chain', category: full._id, purity: 'gold22', variants: [{ sku: 'TC-1', netWeightMg: 8000, stock: 1 }] });
    await createCategory('Kids Jewellery'); // no pieces yet
    const circle = (kind: string, ref: string, label = '', href = '') => ({ kind, ref, label, href, image: null });
    const homePage = (circles: unknown[]) => ({ homePage: { pricingImage: null, savingsImage: null, trust: [], promos: [], circles } });

    await admin.patch('/api/admin/settings').send(homePage([])).expect(200);
    expect((await api().get('/api/home').expect(200)).body.circles).toBeUndefined();

    await admin
      .patch('/api/admin/settings')
      .send(
        homePage([
          circle('link', '', '22K jewellery', '/shop?purity=gold22'),
          circle('category', 'kids-jewellery'),
          circle('category', 'mangalsutra', 'Thali'),
          circle('collection', 'no-such-collection'),
          circle('link', '', '', '/shop'),
        ]),
      )
      .expect(200);
    expect((await api().get('/api/home').expect(200)).body.circles).toEqual([
      { label: '22K jewellery', href: '/shop?purity=gold22' },
      { label: 'Thali', href: '/shop/mangalsutra' },
    ]);
    await admin.patch('/api/admin/settings').send(homePage([circle('link', '', 'Bad', 'javascript:alert(1)')])).expect(400);
  });

  it('serves the homepage trust row and tiles, dropping incomplete ones and unsafe links', async () => {
    const admin = await signIn('admin@example.com');
    const tile = (title: string, href: string) => ({ title, text: '', ctaLabel: '', href, image: null });
    const homePage = { pricingImage: null, savingsImage: null, trust: [{ title: 'Secure shopping', text: '', icon: 'lock' }, { title: '', text: '', icon: '' }] };
    await admin.patch('/api/admin/settings').send({ homePage: { ...homePage, promos: [tile('Gold rate', '/gold-rate'), tile('', '/shop'), tile('No link', '')] } }).expect(200);
    const pub = (await api().get('/api/settings').expect(200)).body.homePage;
    expect(pub.trust).toEqual([{ title: 'Secure shopping', text: '', icon: 'lock' }]);
    expect(pub.promos).toEqual([{ title: 'Gold rate', ctaLabel: 'Explore', href: '/gold-rate' }]);
    await admin.patch('/api/admin/settings').send({ homePage: { ...homePage, promos: [tile('Bad', 'javascript:alert(1)')] } }).expect(400);
    await admin.patch('/api/admin/settings').send({ homePage: { ...homePage, promos: [1, 2, 3, 4].map((k) => tile(`T${k}`, '/shop')) } }).expect(400);
  });

  it('publishes the brand-story section only when it is switched on', async () => {
    const admin = await signIn('admin@example.com');
    const about = {
      enabled: false,
      eyebrow: 'About us',
      title: 'A Legacy of',
      highlight: 'Trust & Timeless Beauty',
      tagline: '',
      body: 'First paragraph.\n\nSecond paragraph.',
      badge: 'Crafted with care',
      features: [{ label: 'Customer first approach', icon: 'users' }],
      image: null,
      insetImage: null,
    };
    await admin.patch('/api/admin/settings').send({ about, stats: [{ value: '25+', label: 'Years of trust', icon: 'store' }] }).expect(200);
    expect((await api().get('/api/settings').expect(200)).body.about).toBeUndefined();

    await admin.patch('/api/admin/settings').send({ about: { ...about, enabled: true } }).expect(200);
    const pub = (await api().get('/api/settings').expect(200)).body;
    expect(pub.about).toMatchObject({ title: 'A Legacy of', highlight: 'Trust & Timeless Beauty', badge: 'Crafted with care' });
    expect(pub.about.features).toEqual([{ label: 'Customer first approach', icon: 'users' }]);
    expect(pub.stats).toEqual([{ value: '25+', label: 'Years of trust', icon: 'store' }]);
  });

  it('serves store photos only once uploaded, and caps the gallery at twelve', async () => {
    const admin = await signIn('admin@example.com');
    const before = await api().get('/api/settings').expect(200);
    expect(before.body.storePhotos).toEqual({ images: [] });
    expect(before.headers['cache-control']).toBe('no-cache');

    const photo = (key: string, alt = '') => ({ key, alt, width: 1600, height: 1200 });
    await admin
      .patch('/api/admin/settings')
      .send({ storePhotos: { title: 'Step inside', subtitle: '', images: [photo('store/202610/a', 'Our showroom'), photo(''), photo('store/202610/b')] } })
      .expect(200);
    const pub = (await api().get('/api/settings').expect(200)).body.storePhotos;
    expect(pub.title).toBe('Step inside');
    expect(pub.subtitle).toBeUndefined();
    expect(pub.images.map((i: { key: string; alt: string }) => [i.key, i.alt])).toEqual([
      ['store/202610/a', 'Our showroom'],
      ['store/202610/b', ''],
    ]);

    const tooMany = Array.from({ length: 13 }, (_, k) => photo(`store/202610/${k}`));
    await admin.patch('/api/admin/settings').send({ storePhotos: { title: '', subtitle: '', images: tooMany } }).expect(400);
    const staff = await signIn('staff@example.com');
    await staff.patch('/api/admin/settings').send({ storePhotos: { title: '', subtitle: '', images: [] } }).expect(403);
  });

  it('serves story chapters in order, hiding untitled ones and empty points', async () => {
    const admin = await signIn('admin@example.com');
    expect((await api().get('/api/settings').expect(200)).body.storyChapters).toEqual([]);

    const chapter = (title: string, features: { icon: string; value: string; label: string }[] = []) => ({ title, eyebrow: '', body: 'Text.', image: null, features });
    await admin
      .patch('/api/admin/settings')
      .send({
        storyChapters: [
          chapter('Our Story'),
          chapter(''),
          chapter('Trusted by Thousands', [
            { icon: 'users', value: '50K+', label: 'Happy Customers' },
            { icon: 'gem', value: '', label: '' },
          ]),
        ],
      })
      .expect(200);
    const pub = (await api().get('/api/settings').expect(200)).body.storyChapters;
    expect(pub.map((c: { title: string }) => c.title)).toEqual(['Our Story', 'Trusted by Thousands']);
    expect(pub[0].eyebrow).toBeUndefined();
    expect(pub[1].features).toEqual([{ icon: 'users', value: '50K+', label: 'Happy Customers' }]);

    await admin.patch('/api/admin/settings').send({ storyChapters: Array.from({ length: 9 }, (_, k) => chapter(`Chapter ${k}`)) }).expect(400);
    const staff = await signIn('staff@example.com');
    await staff.patch('/api/admin/settings').send({ storyChapters: [] }).expect(403);
  });

  it('serves the contact page band and reply note, dropping empty items and capping the band at six', async () => {
    const admin = await signIn('admin@example.com');
    const item = (title: string) => ({ title, text: '', icon: 'gem' });
    await admin
      .patch('/api/admin/settings')
      .send({ contactPage: { image: null, subtitle: '', replyNote: 'We usually reply within a day', highlights: [item('Transparent pricing'), item(''), item('Expert guidance')] } })
      .expect(200);
    const pub = (await api().get('/api/settings').expect(200)).body.contactPage;
    expect(pub.replyNote).toBe('We usually reply within a day');
    expect(pub.subtitle).toBeUndefined();
    expect(pub.highlights.map((h: { title: string }) => h.title)).toEqual(['Transparent pricing', 'Expert guidance']);
    await admin.patch('/api/admin/settings').send({ contactPage: { image: null, subtitle: '', replyNote: '', highlights: Array.from({ length: 7 }, (_, k) => item(`Item ${k}`)) } }).expect(400);
  });

  it('serves the journal banner words, falling back to the defaults on older settings', async () => {
    const admin = await signIn('admin@example.com');
    const defaults = ['Knowledge', 'Makes', 'Every Piece', 'More Special'];
    await Settings.updateOne({ key: 'store' }, { $unset: { journalPage: 1 } });
    invalidateSettings();
    expect((await api().get('/api/settings').expect(200)).body.journal).toEqual({ script: defaults });

    await admin.patch('/api/admin/settings').send({ journalPage: { image: null, script: 'Learn\n\n  before you buy ' } }).expect(200);
    expect((await api().get('/api/settings').expect(200)).body.journal).toEqual({ script: ['Learn', 'before you buy'] });
    await admin.patch('/api/admin/settings').send({ journalPage: { image: null, script: '' } }).expect(200);
    expect((await api().get('/api/settings').expect(200)).body.journal.script).toEqual([]);
    // up to five lines; the *gold* markers pass through for the page to style
    await admin.patch('/api/admin/settings').send({ journalPage: { image: null, script: 'More\nThan\n*Gold*\nStories\n*That* Last\nExtra' } }).expect(200);
    expect((await api().get('/api/settings').expect(200)).body.journal.script).toEqual(['More', 'Than', '*Gold*', 'Stories', '*That* Last']);
  });

  it('fills the footer band from live settings and hides items whose figure does not apply', async () => {
    const admin = await signIn('admin@example.com');
    const highlights = [
      { title: 'BIS hallmarked gold', text: 'Guaranteed purity', icon: 'shield' },
      { title: 'Free shipping over {freeShippingAbove}', text: 'Delivered across India', icon: 'truck' },
      { title: 'Easy returns', text: 'Within {returnDays} days of delivery', icon: 'returns' },
    ];
    await admin.patch('/api/admin/settings').send({ footer: { image: null, highlights } }).expect(200);
    const pub = (await api().get('/api/settings').expect(200)).body;
    expect(pub.footer.highlights).toEqual([
      highlights[0],
      { ...highlights[1], title: 'Free shipping over ₹25,000' },
      { ...highlights[2], text: 'Within 7 days of delivery' },
    ]);
    expect(pub.shipping.nationwide).toBe(true);

    // With no threshold to quote (delivery always free) or no return window, those items disappear.
    expect(fillHighlights(highlights, { freeShippingAbove: undefined, returnDays: undefined })).toEqual([highlights[0]]);
    expect(fillHighlights([{ title: 'Typo {unknownThing}', text: '', icon: '' }], {})).toEqual([]);
  });

  it('paginates admin lists', async () => {
    const admin = await signIn('admin@example.com');
    const res = await admin.get('/api/admin/products?limit=1000').expect(200);
    expect(res.body.limit).toBe(100);
  });
});
