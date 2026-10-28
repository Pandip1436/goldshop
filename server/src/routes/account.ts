import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import {
  ORDER_GROUPS,
  changePasswordSchema,
  profileSchema,
  savedAddressSchema,
  type OrderGroup,
  type OrderStatus,
  type SavedAddressDTO,
} from '@goldshop/shared';
import { badRequest, notFound } from '../lib/errors';
import { escapeRegex, objectId, paginated, pagination, parse } from '../lib/http';
import { issueSession, requireAuth } from '../middleware/auth';
import { Order, Product, User, type SavedAddress } from '../models';
import { badgeRules, categoryRefMap, toProductCard, type LeanProduct } from '../services/catalog';
import { toOrderSummary } from '../services/orders';
import { getSettings, ratesFrom } from '../services/settings';
import { BCRYPT_ROUNDS, toSessionUser } from './auth';

export const accountRouter = Router();
accountRouter.use('/account', requireAuth);

function toAddressDTO(a: SavedAddress): SavedAddressDTO {
  return {
    id: String(a._id),
    label: a.label ?? 'Home',
    fullName: a.fullName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 || undefined,
    landmark: a.landmark || undefined,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    isDefault: Boolean(a.isDefault),
  };
}

accountRouter.patch('/account/profile', async (req, res) => {
  const input = parse(profileSchema, req.body);
  const update: Record<string, unknown> = { name: input.name, phone: input.phone };
  if (input.marketingConsent !== undefined) {
    update['marketingConsent.email'] = input.marketingConsent;
    update['marketingConsent.updatedAt'] = new Date();
  }
  const user = await User.findByIdAndUpdate(req.user!.id, { $set: update }, { new: true });
  res.json({ user: toSessionUser(user!) });
});

accountRouter.patch('/account/password', async (req, res) => {
  const input = parse(changePasswordSchema, req.body);
  const user = await User.findById(req.user!.id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw badRequest('Your current password is incorrect.', { currentPassword: 'Incorrect password' });
  }
  user.passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1; // signs out every other device
  await user.save();
  issueSession(res, user);
  res.json({ ok: true });
});

/* ------------------------------------------------------------- addresses */

accountRouter.get('/account/addresses', async (req, res) => {
  const user = await User.findById(req.user!.id).select('addresses').lean();
  res.json((user?.addresses ?? []).map((a) => toAddressDTO(a as SavedAddress)));
});

accountRouter.post('/account/addresses', async (req, res) => {
  const input = parse(savedAddressSchema, req.body);
  const user = await User.findById(req.user!.id).select('addresses');
  if (!user) throw notFound();
  if (user.addresses.length >= 10) throw badRequest('You can save up to 10 addresses.');
  const makeDefault = input.isDefault || user.addresses.length === 0;
  if (makeDefault) user.addresses.forEach((a) => (a.isDefault = false));
  user.addresses.push({ ...input, isDefault: makeDefault });
  await user.save();
  res.status(201).json(user.addresses.map((a) => toAddressDTO(a as unknown as SavedAddress)));
});

accountRouter.patch('/account/addresses/:id', async (req, res) => {
  const input = parse(savedAddressSchema, req.body);
  const user = await User.findById(req.user!.id).select('addresses');
  const addr = user?.addresses.id(String(req.params.id));
  if (!user || !addr) throw notFound('Address not found.');
  if (input.isDefault) user.addresses.forEach((a) => (a.isDefault = false));
  addr.set({ ...input, isDefault: input.isDefault || addr.isDefault });
  await user.save();
  res.json(user.addresses.map((a) => toAddressDTO(a as unknown as SavedAddress)));
});

accountRouter.delete('/account/addresses/:id', async (req, res) => {
  const user = await User.findById(req.user!.id).select('addresses');
  const addr = user?.addresses.id(String(req.params.id));
  if (!user || !addr) throw notFound('Address not found.');
  const wasDefault = addr.isDefault;
  addr.deleteOne();
  if (wasDefault && user.addresses[0]) user.addresses[0].isDefault = true;
  await user.save();
  res.json(user.addresses.map((a) => toAddressDTO(a as unknown as SavedAddress)));
});

/* ---------------------------------------------------------------- orders */

const ORDER_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  amount_desc: { 'pricing.total': -1, createdAt: -1 },
  amount_asc: { 'pricing.total': 1, createdAt: -1 },
} as const;

/** The signed-in customer's orders, by group (?status=), searched by order number or piece (?q=). */
accountRouter.get('/account/orders', async (req, res) => {
  const { page, limit, skip } = pagination(req, 20, 10);
  const mine = { user: new Types.ObjectId(req.user!.id) };
  const filter: Record<string, unknown> = { ...mine };
  const group = String(req.query.status ?? '') as OrderGroup;
  if (group in ORDER_GROUPS) filter.status = { $in: ORDER_GROUPS[group] };
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ orderNumber: rx }, { 'items.name': rx }];
  }
  const sortKey = String(req.query.sort ?? '') as keyof typeof ORDER_SORTS;
  const sort = ORDER_SORTS[sortKey] ?? ORDER_SORTS.newest;

  const [items, total, byStatus] = await Promise.all([
    Order.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
    Order.aggregate<{ _id: OrderStatus; n: number }>([{ $match: mine }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const n = new Map(byStatus.map((s) => [s._id, s.n]));
  const sum = (statuses: readonly OrderStatus[]) => statuses.reduce((t, s) => t + (n.get(s) ?? 0), 0);
  const counts = {
    all: byStatus.reduce((t, s) => t + s.n, 0),
    ...(Object.fromEntries(Object.entries(ORDER_GROUPS).map(([k, v]) => [k, sum(v)])) as Record<OrderGroup, number>),
  };
  res.json({ ...paginated(items.map(toOrderSummary), total, page, limit), counts });
});

/* -------------------------------------------------------------- wishlist */

async function wishlistCards(ids: unknown[]) {
  if (!ids.length) return [];
  const settings = await getSettings();
  const ctx = { rates: ratesFrom(settings), gstRateBps: settings.tax?.gstRateBps ?? 300 };
  const [docs, catMap, rules] = await Promise.all([
    Product.find({ _id: { $in: ids }, isActive: true }).select('-description').lean<LeanProduct[]>(),
    categoryRefMap(),
    badgeRules(),
  ]);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ids
    .map((id) => byId.get(String(id)))
    .filter((d): d is LeanProduct => Boolean(d))
    .map((d) => toProductCard(d, ctx, catMap, rules));
}

accountRouter.get('/account/wishlist', async (req, res) => {
  const user = await User.findById(req.user!.id).select('wishlist').lean();
  res.json(await wishlistCards([...(user?.wishlist ?? [])].reverse()));
});

accountRouter.post('/account/wishlist', async (req, res) => {
  const { productId } = parse(z.object({ productId: z.string() }), req.body);
  const id = objectId(productId, 'Product');
  if (!(await Product.exists({ _id: id, isActive: true }))) throw notFound('Product not found.');
  await User.updateOne({ _id: req.user!.id }, { $addToSet: { wishlist: id } });
  const user = await User.findById(req.user!.id).select('wishlist').lean();
  res.json({ ids: (user?.wishlist ?? []).map(String) });
});

accountRouter.delete('/account/wishlist/:productId', async (req, res) => {
  const id = objectId(String(req.params.productId), 'Product');
  await User.updateOne({ _id: req.user!.id }, { $pull: { wishlist: id } });
  const user = await User.findById(req.user!.id).select('wishlist').lean();
  res.json({ ids: (user?.wishlist ?? []).map(String) });
});

/** Merges a signed-out wishlist (kept in the browser) into the account after sign-in. */
accountRouter.post('/account/wishlist/merge', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(100) }), req.body);
  if (ids.length) {
    const existing = await Product.find({ _id: { $in: ids }, isActive: true }).select('_id').lean();
    await User.updateOne({ _id: req.user!.id }, { $addToSet: { wishlist: { $each: existing.map((p) => p._id) } } });
  }
  const user = await User.findById(req.user!.id).select('wishlist').lean();
  const all = (user?.wishlist ?? []).map(String);
  if (all.length > 200) {
    await User.updateOne({ _id: req.user!.id }, { $set: { wishlist: all.slice(-200) } });
  }
  res.json({ ids: all.slice(-200) });
});
