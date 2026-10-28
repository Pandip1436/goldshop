import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { FilterQuery } from 'mongoose';
import { normalizeIndianMobile } from '@goldshop/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { escapeRegex, objectId, paginated, pagination, parse } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { Order, User } from '../../models';
import { toOrderSummary } from '../../services/orders';
import { BCRYPT_ROUNDS } from '../auth';
import { staffInput, staffUpdateInput } from './schemas';

export const adminPeopleRouter = Router();

adminPeopleRouter.get('/customers', requirePermission('customers:read'), async (req, res) => {
  const { page, limit, skip } = pagination(req, 100, 25);
  const filter: FilterQuery<typeof User> = { role: 'customer' };
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const phone = normalizeIndianMobile(q);
    filter.$or = [{ name: rx }, { email: rx }, ...(phone.length >= 5 ? [{ phone: new RegExp(escapeRegex(phone)) }] : [])];
  }
  const sort: Record<string, 1 | -1> = req.query.sort === 'spent' ? { totalSpent: -1 } : { createdAt: -1 };
  const [items, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).select('name email phone orderCount totalSpent createdAt lastLoginAt marketingConsent isActive').lean(),
    User.countDocuments(filter),
  ]);
  res.json(paginated(items.map((u) => ({ ...u, id: String(u._id) })), total, page, limit));
});

adminPeopleRouter.get('/customers/:id', requirePermission('customers:read'), async (req, res) => {
  const user = await User.findById(objectId(String(req.params.id))).select('-wishlist').lean();
  if (!user) throw notFound('Customer not found.');
  const orders = await Order.find({ $or: [{ user: user._id }, { 'customer.email': user.email }] })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ ...user, id: String(user._id), orders: orders.map(toOrderSummary) });
});

/* ------------------------------------------------------------------ staff */

adminPeopleRouter.get('/staff', requirePermission('staff:write'), async (_req, res) => {
  const staff = await User.find({ role: { $in: ['admin', 'staff'] } }).sort({ role: 1, name: 1 }).select('name email role isActive lastLoginAt createdAt').lean();
  res.json(staff.map((s) => ({ ...s, id: String(s._id) })));
});

adminPeopleRouter.post('/staff', requirePermission('staff:write'), async (req, res) => {
  const input = parse(staffInput, req.body);
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    if (existing.role === input.role) throw conflict('This person already has that role.');
    existing.role = input.role;
    existing.tokenVersion = (existing.tokenVersion ?? 0) + 1; // re-login picks up the new role everywhere
    await existing.save();
    return void res.json({ id: String(existing._id), promoted: true });
  }
  if (!input.password) throw badRequest('Set a password for the new account.', { password: 'Required for new accounts' });
  const user = await User.create({
    name: input.name,
    email: input.email,
    role: input.role,
    passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
  });
  res.status(201).json({ id: String(user._id) });
});

adminPeopleRouter.patch('/staff/:id', requirePermission('staff:write'), async (req, res) => {
  const input = parse(staffUpdateInput, req.body);
  const id = objectId(String(req.params.id));
  if (String(id) === req.user!.id && (input.role !== undefined && input.role !== 'admin' || input.isActive === false)) {
    throw badRequest("You can't remove your own admin access.");
  }
  const user = await User.findById(id);
  if (!user) throw notFound();
  if (user.role === 'admin' && (input.role && input.role !== 'admin' || input.isActive === false)) {
    const admins = await User.countDocuments({ role: 'admin', isActive: true });
    if (admins <= 1) throw badRequest('There must always be at least one active admin.');
  }
  if (input.role) user.role = input.role;
  if (input.isActive !== undefined) user.isActive = input.isActive;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  res.json({ ok: true });
});
