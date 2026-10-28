import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '../src/app';
import { hmacSha256Hex } from '../src/lib/crypto';
import { invalidatePublicCache } from '../src/lib/cache';
import { Category, Product, Settings, User } from '../src/models';
import { applyDerivedFields, categoryLineage } from '../src/services/catalog';
import type { GatewayPayment, PaymentGateway } from '../src/services/razorpay';
import { invalidateSettings } from '../src/services/settings';

export const app = createApp();
export const agent = () => request.agent(app);
export const api = () => request(app);

export const RATES = { gold24: 1_280_000, gold22: 1_173_000, gold18: 960_000 };

export async function seedSettings(overrides: Record<string, unknown> = {}) {
  await Settings.deleteMany({});
  await Settings.create({
    key: 'store',
    store: { name: 'Test Jewellers', email: 'store@example.com', phone: '9876543210', address: { line1: '1 Main Rd', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', line2: '' } },
    goldRates: { ...RATES, updatedAt: new Date() },
    tax: { gstRateBps: 300, hsnCode: '7113' },
    checkout: { guestCheckout: true, orderPrefix: 'TS', codEnabled: true, codMaxOrderValue: 0, codFee: 0, returnWindowDays: 7 },
    shipping: {
      zones: [
        { name: 'Tamil Nadu', states: ['Tamil Nadu'], pinPrefixes: ['60', '61', '62', '63', '64'], rate: 0, freeAbove: 0, codAvailable: true, etaMinDays: 1, etaMaxDays: 3, isActive: true },
      ],
      fallbackEnabled: true,
      fallbackRate: 25_000,
      fallbackFreeAbove: 2_500_000,
      fallbackCod: false,
      fallbackEtaMin: 3,
      fallbackEtaMax: 7,
      note: '',
    },
    ...overrides,
  });
  invalidateSettings();
  invalidatePublicCache();
}

export async function setSettings(update: Record<string, unknown>) {
  await Settings.updateOne({ key: 'store' }, { $set: update });
  invalidateSettings();
  invalidatePublicCache();
}

export async function createCategory(name: string, parent?: Types.ObjectId) {
  return Category.create({ name, slug: name.toLowerCase().replace(/\s+/g, '-'), parent: parent ?? null });
}

interface VariantSpec {
  sku: string;
  label?: string;
  netWeightMg?: number;
  stock: number;
  stoneCharge?: number;
  fixedPrice?: number;
  isActive?: boolean;
  attributes?: Record<string, string>;
}

export async function createProduct(spec: {
  name: string;
  category: Types.ObjectId;
  purity?: 'gold22' | 'gold18' | 'gold24';
  pricingMode?: 'weight' | 'fixed';
  making?: { type: 'percent' | 'per_gram' | 'flat'; value: number };
  makingDiscountPercent?: number;
  variants: VariantSpec[];
  tags?: string[];
  isFeatured?: boolean;
  isActive?: boolean;
  soldCount?: number;
  collections?: Types.ObjectId[];
}) {
  const doc = {
    name: spec.name,
    slug: spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category: spec.category,
    categoryPath: await categoryLineage(spec.category),
    collections: spec.collections ?? [],
    tags: spec.tags ?? [],
    purity: spec.purity,
    pricingMode: spec.pricingMode ?? 'weight',
    making: spec.making ?? { type: 'percent', value: 12 },
    makingDiscountPercent: spec.makingDiscountPercent ?? 0,
    isFeatured: spec.isFeatured ?? false,
    isActive: spec.isActive ?? true,
    soldCount: spec.soldCount ?? 0,
    optionNames: spec.variants.length > 1 ? ['Size'] : [],
    variants: spec.variants.map((v) => ({
      _id: new Types.ObjectId(),
      sku: v.sku,
      label: v.label ?? 'Standard',
      attributes: v.attributes ?? (v.label ? { Size: v.label } : {}),
      netWeightMg: v.netWeightMg ?? 0,
      grossWeightMg: v.netWeightMg ?? 0,
      stoneCharge: v.stoneCharge ?? 0,
      fixedPrice: v.fixedPrice ?? 0,
      compareAtPrice: 0,
      stock: v.stock,
      isActive: v.isActive ?? true,
      priceCache: 0,
    })),
    minPrice: 0,
    maxPrice: 0,
    inStock: false,
    totalStock: 0,
  };
  const settings = await Settings.findOne({ key: 'store' }).lean();
  applyDerivedFields(doc, { rates: (settings?.goldRates as typeof RATES) ?? RATES, gstRateBps: settings?.tax?.gstRateBps ?? 300 });
  return Product.create(doc);
}

export async function createUser(role: 'customer' | 'staff' | 'admin', email: string, password = 'password123') {
  return User.create({ name: `${role} user`, email, role, passwordHash: await bcrypt.hash(password, 4) });
}

export async function signIn(email: string, password = 'password123') {
  const a = agent();
  const res = await a.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return a;
}

export const ADDRESS_TN = {
  fullName: 'Priya Raman',
  phone: '9876543210',
  line1: '12 Temple Street',
  line2: 'Mylapore',
  landmark: '',
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600004',
};

export const ADDRESS_KA = { ...ADDRESS_TN, city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };

export function checkoutBody(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: 'Priya Raman', email: 'priya@example.com', phone: '+91 98765 43210' },
    address: ADDRESS_TN,
    paymentMethod: 'cod',
    ...overrides,
  };
}

/** In-memory stand-in for the Razorpay API. */
export function fakeGateway() {
  const orders = new Map<string, { id: string; amount: number; currency: string; status: string; receipt?: string }>();
  const payments = new Map<string, GatewayPayment>();
  const state = { failCreate: false, created: 0, refunds: [] as { paymentId: string; amount: number }[] };
  const gw: PaymentGateway = {
    async createOrder({ amount, receipt }) {
      if (state.failCreate) throw new Error('gateway down');
      state.created++;
      const id = `order_${crypto.randomBytes(6).toString('hex')}`;
      const o = { id, amount, currency: 'INR', status: 'created', receipt };
      orders.set(id, o);
      return o;
    },
    async fetchPayment(id) {
      const p = payments.get(id);
      if (!p) throw new Error('no such payment');
      return { ...p };
    },
    async capturePayment(id) {
      const p = payments.get(id)!;
      p.status = 'captured';
      return { ...p };
    },
    async fetchOrderPayments(orderId) {
      return [...payments.values()].filter((p) => p.order_id === orderId);
    },
    async refund(paymentId, amount) {
      state.refunds.push({ paymentId, amount });
      return { id: `rfnd_${crypto.randomBytes(4).toString('hex')}`, payment_id: paymentId, amount, status: 'processed' };
    },
  };
  return {
    gw,
    state,
    orders,
    /** Simulates the customer paying in Razorpay Checkout. */
    pay(orderId: string, amount: number, status: GatewayPayment['status'] = 'captured') {
      const id = `pay_${crypto.randomBytes(6).toString('hex')}`;
      payments.set(id, { id, order_id: orderId, amount, currency: 'INR', status, method: 'upi' });
      return id;
    },
  };
}

export const checkoutSignature = (orderId: string, paymentId: string) => hmacSha256Hex('test_key_secret', `${orderId}|${paymentId}`);
export const webhookSignature = (body: string) => hmacSha256Hex('test_webhook_secret', body);
