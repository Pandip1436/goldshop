import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Enquiry } from '../src/models';
import { testOutbox } from '../src/services/mailer';
import { api, createUser, seedSettings, signIn } from './helpers';

const callBack = { type: 'savings_plan', name: 'Kavya S', phone: '9000012345', preferredContact: 'phone', monthlyAmount: 200_000, consent: true };

beforeAll(async () => {
  await seedSettings();
});
beforeEach(() => {
  testOutbox.length = 0;
});

describe('savings plan call-back requests', () => {
  it('needs a mobile number to call and permission to use it', async () => {
    const noPhone = await api().post('/api/enquiries').send({ ...callBack, phone: '', email: 'kavya@example.com' }).expect(400);
    expect(noPhone.body.error.fields.phone).toMatch(/mobile number/);
    const noConsent = await api().post('/api/enquiries').send({ ...callBack, consent: false }).expect(400);
    expect(noConsent.body.error.fields.consent).toBeTruthy();
    const emailWithoutAddress = await api().post('/api/enquiries').send({ ...callBack, preferredContact: 'email' }).expect(400);
    expect(emailWithoutAddress.body.error.fields.email).toBeTruthy();
    expect(await Enquiry.countDocuments({ type: 'savings_plan' })).toBe(0);
  });

  it('stores the request and tells the shop how and how much', async () => {
    const res = await api().post('/api/enquiries').send({ ...callBack, message: 'Wedding next year' }).expect(201);
    expect(res.body.message).toMatch(/We'll call you/);
    const saved = await Enquiry.findOne({ type: 'savings_plan', phone: '9000012345' }).lean();
    expect(saved).toMatchObject({ name: 'Kavya S', monthlyAmount: 200_000, preferredContact: 'phone', consent: true, status: 'new' });

    // The notification is sent after the response, so wait for it.
    await vi.waitFor(() => expect(testOutbox).toHaveLength(1));
    expect(testOutbox[0].to).toBe('store@example.com');
    expect(testOutbox[0].text).toContain('Prefers: Phone call');
    expect(testOutbox[0].text).toContain('Monthly amount: ₹2,000');
  });

  it('still lets a product enquiry be answered by email alone', async () => {
    await api().post('/api/enquiries').send({ type: 'product', name: 'Arun', email: 'arun@example.com', message: 'Is this available in 18K?' }).expect(201);
  });
});

describe('contact form', () => {
  const message = { type: 'contact', name: 'Arun Kumar', phone: '9876501234', topic: 'sizing', message: 'Can you resize a ring to 14?', consent: true };

  it('needs a number, a topic, a real message and consent', async () => {
    const bad = await api().post('/api/enquiries').send({ type: 'contact', name: 'Arun', email: 'arun@example.com', message: 'Hi' }).expect(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['consent', 'message', 'phone', 'topic']);
    await api().post('/api/enquiries').send({ ...message, topic: 'gossip' }).expect(400);
  });

  it('stores the topic and puts it in the note to the shop', async () => {
    await api().post('/api/enquiries').send(message).expect(201);
    const saved = await Enquiry.findOne({ type: 'contact', phone: '9876501234' }).lean();
    expect(saved?.topic).toBe('sizing');
    await vi.waitFor(() => expect(testOutbox).toHaveLength(1));
    expect(testOutbox[0].text).toContain('About: Sizing and fit');
  });
});

describe('savings plan page content', () => {
  it('publishes only the filled-in points', async () => {
    await seedSettings({
      savingsPlan: {
        enabled: true,
        summary: 'Save a little each month.',
        image: null,
        stepsImage: null,
        features: [
          { title: 'Save easily', text: 'Set a monthly amount', icon: 'coins' },
          { title: '', text: 'orphan', icon: '' },
        ],
        highlights: [{ title: 'Transparent pricing', text: 'No hidden charges', icon: 'shield' }],
      },
    });
    const plan = (await api().get('/api/settings').expect(200)).body.savingsPlan;
    expect(plan).toEqual({
      enabled: true,
      summary: 'Save a little each month.',
      script: [],
      features: [{ title: 'Save easily', text: 'Set a monthly amount', icon: 'coins' }],
      schemes: [],
      highlights: [{ title: 'Transparent pricing', text: 'No hidden charges', icon: 'shield' }],
    });
  });

  it('publishes the plans with their filled-in points, and up to five script lines', async () => {
    const plan = (title: string, points: string[], details = '') => ({ title, eyebrow: '', points, image: null, details });
    await seedSettings({
      savingsPlan: {
        enabled: true,
        summary: '',
        image: null,
        stepsImage: null,
        tagline: 'Plan Today | Save Easily',
        script: 'Save\nToday\n\nfor a\nShining\nTomorrow\nAlways',
        features: [],
        schemes: [plan('Wedding Scheme', ['Plan ahead for weddings', '']), plan('', ['orphan']), plan('Monthly Savings Scheme', [], 'Twelve monthly instalments.')],
        highlights: [],
      },
    });
    const pub = (await api().get('/api/settings').expect(200)).body.savingsPlan;
    expect(pub.tagline).toBe('Plan Today | Save Easily');
    expect(pub.script).toEqual(['Save', 'Today', 'for a', 'Shining', 'Tomorrow']);
    expect(pub.schemes).toEqual([
      { title: 'Wedding Scheme', points: ['Plan ahead for weddings'] },
      { title: 'Monthly Savings Scheme', points: [], details: 'Twelve monthly instalments.' },
    ]);
  });

  it('accepts four plans, four points and six band items, and no more', async () => {
    await createUser('admin', 'plans.admin@example.com');
    const admin = await signIn('plans.admin@example.com');
    const base = { enabled: true, summary: '', image: null, stepsImage: null };
    const item = (k: number) => ({ title: `Item ${k}`, text: '', icon: '' });
    const scheme = (k: number) => ({ title: `Plan ${k}`, eyebrow: '', points: ['a', 'b', 'c'], image: null, details: '' });
    const ok = { ...base, features: [1, 2, 3, 4].map(item), highlights: [1, 2, 3, 4, 5, 6].map(item), schemes: [1, 2, 3, 4].map(scheme) };
    await admin.patch('/api/admin/settings').send({ savingsPlan: ok }).expect(200);
    await admin.patch('/api/admin/settings').send({ savingsPlan: { ...ok, schemes: [1, 2, 3, 4, 5].map(scheme) } }).expect(400);
    await admin.patch('/api/admin/settings').send({ savingsPlan: { ...ok, highlights: [1, 2, 3, 4, 5, 6, 7].map(item) } }).expect(400);
    await admin.patch('/api/admin/settings').send({ savingsPlan: { ...ok, schemes: [{ ...scheme(1), points: ['a', 'b', 'c', 'd'] }] } }).expect(400);
  });
});
