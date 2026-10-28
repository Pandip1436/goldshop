import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { Enquiry } from '../src/models';
import { api, app, createCategory, createProduct, seedSettings } from './helpers';

const SECRET = 'proxy-secret-for-tests';

beforeAll(async () => {
  await seedSettings();
  const rings = await createCategory('Rings');
  await createProduct({ name: 'Classic Band Ring', category: rings._id, purity: 'gold22', variants: [{ sku: 'CB-1', netWeightMg: 2500, stock: 1 }] });
});

describe('Cloudflare Pages proxy guard', () => {
  beforeAll(() => {
    env.proxySecret = SECRET;
    // as in production (TRUST_PROXY defaults to 1 there)
    app.set('trust proxy', 1);
  });
  afterAll(() => {
    env.proxySecret = '';
    app.set('trust proxy', env.trustProxy);
  });

  it('refuses requests that skip the proxy', async () => {
    await api().get('/api/settings').expect(403);
    await api().get('/api/settings').set('x-proxy-secret', 'wrong').expect(403);
    await api().get('/sitemap.xml').expect(403);
  });

  it('serves requests from the proxy, and the health check without it', async () => {
    await api().get('/api/settings').set('x-proxy-secret', SECRET).expect(200);
    await api().get('/api/health').expect(200);
  });

  it("records the visitor's IP sent by the proxy, not a forged forwarded-for", async () => {
    await api()
      .post('/api/enquiries')
      .set('x-proxy-secret', SECRET)
      .set('x-client-ip', '203.0.113.7')
      .set('x-forwarded-for', '198.51.100.1')
      .send({ type: 'newsletter', email: 'visitor@example.com', consent: true })
      .expect(201);
    const saved = await Enquiry.findOne({ email: 'visitor@example.com' }).select('+ip').lean();
    expect(saved?.ip).toBe('203.0.113.7');
  });
});

describe('SEO tags for the edge', () => {
  it("returns a product page's tags, and 404 for a missing product", async () => {
    const res = await api().get('/api/seo/head').query({ path: '/product/classic-band-ring' }).expect(200);
    expect(res.body.status).toBe(200);
    expect(res.body.head).toContain('<title data-ssr-head>Classic Band Ring');
    expect(res.body.head).toContain('og:title');

    const missing = await api().get('/api/seo/head').query({ path: '/product/no-such-piece' }).expect(200);
    expect(missing.body.status).toBe(404);
  });
});

describe('background jobs endpoint', () => {
  afterAll(() => {
    env.cronSecret = '';
  });

  it('is off until CRON_SECRET is set, then needs it', async () => {
    await api().post('/api/internal/jobs').expect(404);
    env.cronSecret = 'cron-secret-for-tests';
    await api().post('/api/internal/jobs').set('x-cron-secret', 'wrong').expect(403);
    const res = await api().post('/api/internal/jobs').set('x-cron-secret', 'cron-secret-for-tests').expect(200);
    expect(res.body).toEqual({ ok: true, ran: true });
  });
});
