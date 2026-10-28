import { beforeEach, describe, expect, it } from 'vitest';
import { GoldRateLog } from '../src/models';
import { invalidatePublicCache } from '../src/lib/cache';
import { RATES, api, createUser, seedSettings, signIn } from './helpers';

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await GoldRateLog.deleteMany({});
  invalidatePublicCache();
});

describe('public gold-rate page', () => {
  it('reports no 24-hour change until there is a day of rate history', async () => {
    await seedSettings();
    const res = await api().get('/api/gold-rates').expect(200);
    expect(res.body.rates).toEqual(RATES);
    expect(res.body.updatedAt).toBeTruthy();
    expect(res.body.previous).toBeUndefined();

    // A change made only a few hours ago is not "24 hours ago".
    await GoldRateLog.create({ rates: { ...RATES, gold22: 1_150_000 } });
    invalidatePublicCache();
    expect((await api().get('/api/gold-rates').expect(200)).body.previous).toBeUndefined();
  });

  it('compares with the snapshot that was in force 24 hours ago', async () => {
    await seedSettings();
    await new GoldRateLog({ rates: { gold24: 1_200_000, gold22: 1_100_000, gold18: 900_000 }, createdAt: new Date(Date.now() - 72 * HOUR) }).save({ timestamps: false });
    await new GoldRateLog({ rates: { gold24: 1_270_000, gold22: 1_165_000, gold18: 955_000, gold14: 700_000 }, createdAt: new Date(Date.now() - 30 * HOUR) }).save({ timestamps: false });
    await new GoldRateLog({ rates: { gold24: 1_275_000, gold22: 1_170_000, gold18: 958_000 }, createdAt: new Date(Date.now() - 2 * HOUR) }).save({ timestamps: false });
    const res = await api().get('/api/gold-rates').expect(200);
    // Only purities on sale now are compared (14K is not sold any more).
    expect(res.body.previous).toEqual({ gold24: 1_270_000, gold22: 1_165_000, gold18: 955_000 });
  });

  it('publishes the page photo, script and only the filled-in highlights', async () => {
    await seedSettings({
      goldRatePage: {
        image: null,
        script: 'Pure Gold\n Timeless \n\nValue',
        highlights: [
          { title: 'Transparent pricing', text: 'No hidden charges', icon: 'shield' },
          { title: '', text: 'orphan text', icon: 'gem' },
        ],
      },
    });
    const { page } = (await api().get('/api/gold-rates').expect(200)).body;
    expect(page.image).toBeUndefined();
    expect(page.script).toEqual(['Pure Gold', 'Timeless', 'Value']);
    expect(page.highlights).toEqual([{ title: 'Transparent pricing', text: 'No hidden charges', icon: 'shield' }]);
  });
});

describe('gold-rate history', () => {
  it('records the rates already in force before the first change, dated when they were set', async () => {
    const setAt = new Date(Date.now() - 26 * HOUR);
    await seedSettings({ goldRates: { ...RATES, updatedAt: setAt, updatedBy: 'Opening rates' } });
    await createUser('admin', 'rates-admin@example.com');
    const admin = await signIn('rates-admin@example.com');

    await admin.put('/api/admin/gold-rates').send({ rates: { gold22: 1_180_000 } }).expect(200);
    const logs = await GoldRateLog.find().sort({ createdAt: 1 }).lean();
    expect(logs).toHaveLength(2);
    expect(logs[0].createdAt.getTime()).toBe(setAt.getTime());
    expect(logs[0].rates).toMatchObject(RATES);
    expect(logs[0].byName).toBe('Opening rates');
    expect(logs[1].rates).toMatchObject({ ...RATES, gold22: 1_180_000 });

    // The public page now shows the genuine change against the rate a day earlier.
    const pub = (await api().get('/api/gold-rates').expect(200)).body;
    expect(pub.rates.gold22).toBe(1_180_000);
    expect(pub.previous.gold22).toBe(RATES.gold22);

    // Later changes don't add another baseline.
    await admin.put('/api/admin/gold-rates').send({ rates: { gold22: 1_185_000 } }).expect(200);
    expect(await GoldRateLog.countDocuments()).toBe(3);
  });

  it('serves the public trend: the rate in force when the period began, then each change', async () => {
    await seedSettings();
    await new GoldRateLog({ rates: { gold22: 1_100_000 }, createdAt: new Date(Date.now() - 50 * 24 * HOUR) }).save({ timestamps: false });
    await new GoldRateLog({ rates: { gold22: 1_120_000 }, createdAt: new Date(Date.now() - 40 * 24 * HOUR) }).save({ timestamps: false });
    await new GoldRateLog({ rates: { gold22: 1_150_000, gold24: 0 }, createdAt: new Date(Date.now() - 5 * 24 * HOUR) }).save({ timestamps: false });
    const { body } = await api().get('/api/gold-rates/history?days=30').expect(200);
    // 40 days ago is before the period, so it opens the trend; 50 days ago is not needed.
    expect(body.points.map((p: { rates: { gold22: number } }) => p.rates.gold22)).toEqual([1_120_000, 1_150_000]);
    expect(body.points[1].rates).toEqual({ gold22: 1_150_000 });
    expect(Date.parse(body.since)).toBeLessThan(Date.now() - 29 * 24 * HOUR);
  });

  it('shows the current rate as the only point before anything is logged', async () => {
    const setAt = new Date(Date.now() - 3 * HOUR);
    await seedSettings({ goldRates: { ...RATES, updatedAt: setAt } });
    const { body } = await api().get('/api/gold-rates/history').expect(200);
    expect(body.points).toEqual([{ at: setAt.toISOString(), rates: RATES }]);
  });

  it('publishes a picture per purity and up to six highlights', async () => {
    await seedSettings();
    await createUser('admin', 'page-admin@example.com');
    const admin = await signIn('page-admin@example.com');
    const pic = { key: 'gold-rate/202610/bars', alt: 'Gold bars', width: 490, height: 310 };
    const item = (k: number) => ({ title: `Item ${k}`, text: '', icon: '' });
    await admin
      .patch('/api/admin/settings')
      .send({ goldRatePage: { image: null, script: '', highlights: [1, 2, 3, 4, 5, 6].map(item), purityImages: { gold24: pic, gold22: null } } })
      .expect(200);
    const { page } = (await api().get('/api/gold-rates').expect(200)).body;
    expect(page.purityImages).toEqual({ gold24: pic });
    expect(page.highlights).toHaveLength(6);
    await admin.patch('/api/admin/settings').send({ goldRatePage: { image: null, script: '', highlights: [1, 2, 3, 4, 5, 6, 7].map(item) } }).expect(400);
  });

  it('only lets admins edit the page content', async () => {
    await seedSettings();
    await createUser('staff', 'rates-staff@example.com');
    const staff = await signIn('rates-staff@example.com');
    await staff.patch('/api/admin/settings').send({ goldRatePage: { script: 'x', highlights: [] } }).expect(403);
  });
});
