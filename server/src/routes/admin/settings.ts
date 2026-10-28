import { Router } from 'express';
import { PURITY_KEYS } from '@goldshop/shared';
import { env } from '../../config/env';
import { invalidatePublicCache } from '../../lib/cache';
import { badRequest } from '../../lib/errors';
import { paginated, pagination, parse } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { GoldRateLog, Settings } from '../../models';
import { repriceAllProducts } from '../../services/catalog';
import { getSettings, invalidateSettings, ratesFrom } from '../../services/settings';
import { goldRatesInput, settingsInput } from './schemas';

export const adminSettingsRouter = Router();

adminSettingsRouter.get('/settings', requirePermission('dashboard:read'), async (_req, res) => {
  const s = await getSettings({ fresh: true });
  res.json({
    ...s,
    integrations: {
      razorpay: env.razorpay.enabled,
      razorpayKeyMode: env.razorpay.keyId.startsWith('rzp_live_') ? 'live' : env.razorpay.keyId.startsWith('rzp_test_') ? 'test' : 'none',
      razorpayWebhook: Boolean(env.razorpay.webhookSecret),
      email: env.smtp.enabled,
      pincodeLookup: env.pincodeLookup,
      publicUrl: env.publicUrl,
    },
  });
});

adminSettingsRouter.patch('/settings', requirePermission('settings:write'), async (req, res) => {
  const input = parse(settingsInput, req.body);
  const $set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) $set[k] = v;
  if (input.shipping) {
    for (const z of input.shipping.zones) {
      if (z.etaMaxDays < z.etaMinDays) throw badRequest(`Zone "${z.name}": maximum days must be at least the minimum.`);
    }
  }
  const gstChanged = input.tax !== undefined;
  await Settings.updateOne({ key: 'store' }, { $set }, { upsert: true, runValidators: true });
  invalidateSettings();
  if (gstChanged) {
    const s = await getSettings({ fresh: true });
    await repriceAllProducts({ rates: ratesFrom(s), gstRateBps: s.tax.gstRateBps });
  }
  invalidatePublicCache();
  res.json(await getSettings({ fresh: true }));
});

/**
 * Updates today's metal rates and immediately re-prices every weight-based product. Carts are
 * priced live, so shoppers see the new price on their next view (with a "price changed" note).
 */
adminSettingsRouter.put('/gold-rates', requirePermission('rates:write'), async (req, res) => {
  const { rates } = parse(goldRatesInput, req.body);
  const current = await getSettings({ fresh: true });
  const $set: Record<string, unknown> = { 'goldRates.updatedAt': new Date(), 'goldRates.updatedBy': req.user!.name };
  for (const k of PURITY_KEYS) {
    const v = rates[k];
    if (v === undefined) continue;
    const prev = current.goldRates?.[k] ?? 0;
    // A rate that moves more than 25% in one update is almost always a typo (e.g. per 10 g entered as per gram).
    if (prev > 0 && v > 0 && Math.abs(v - prev) / prev > 0.25 && req.body?.confirmLargeChange !== true) {
      throw badRequest(`The ${k} rate changed by more than 25%. Check the figure is per gram, then confirm.`, { [k]: 'Large change' }, 'confirm_large_change');
    }
    $set[`goldRates.${k}`] = v;
  }
  // The history starts with the first change made here. Record the rates that were already in
  // force (dated when they were set) so the public 24-hour comparison has a genuine starting point.
  const before = ratesFrom(current);
  if (current.goldRates?.updatedAt && Object.keys(before).length && !(await GoldRateLog.exists({}))) {
    await new GoldRateLog({ rates: before, byName: current.goldRates.updatedBy || undefined, createdAt: current.goldRates.updatedAt }).save({ timestamps: false });
  }
  await Settings.updateOne({ key: 'store' }, { $set }, { upsert: true });
  invalidateSettings();
  const s = await getSettings({ fresh: true });
  const repriced = await repriceAllProducts({ rates: ratesFrom(s), gstRateBps: s.tax?.gstRateBps ?? 300 });
  await GoldRateLog.create({ rates: ratesFrom(s), by: req.user!.id, byName: req.user!.name, productsRepriced: repriced });
  invalidatePublicCache();
  res.json({ goldRates: s.goldRates, productsRepriced: repriced });
});

adminSettingsRouter.get('/gold-rates/history', requirePermission('dashboard:read'), async (req, res) => {
  const { page, limit, skip } = pagination(req, 100, 30);
  const [items, total] = await Promise.all([
    GoldRateLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    GoldRateLog.countDocuments(),
  ]);
  res.json(paginated(items, total, page, limit));
});
