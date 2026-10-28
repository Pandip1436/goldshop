import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ENQUIRY_TYPES } from '@goldshop/shared';
import { notFound } from '../../lib/errors';
import { objectId, paginated, pagination, parse } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { Banner, Coupon, CouponRedemption, Enquiry, Faq, Page, Post, Product, Review, Testimonial } from '../../models';
import { mountCrud } from './crud';
import { bannerInput, couponInput, faqInput, pageInput, postInput, testimonialInput } from './schemas';

export const adminContentRouter = Router();

mountCrud(adminContentRouter, 'coupons', Coupon, couponInput, 'coupons:write', {
  sort: { createdAt: -1 },
  readPermission: 'dashboard:read',
});
mountCrud(adminContentRouter, 'banners', Banner, bannerInput, 'content:write', {
  sort: { sortOrder: 1, createdAt: -1 },
  nullableImages: ['image', 'mobileImage'],
});
mountCrud(adminContentRouter, 'testimonials', Testimonial, testimonialInput, 'content:write', { sort: { sortOrder: 1, createdAt: -1 } });
mountCrud(adminContentRouter, 'pages', Page, pageInput, 'content:write', { sort: { slug: 1 } });
mountCrud(adminContentRouter, 'posts', Post, postInput, 'content:write', {
  sort: { publishedAt: -1, createdAt: -1 },
  slugFrom: 'title',
  nullableImages: ['cover'],
});
mountCrud(adminContentRouter, 'faqs', Faq, faqInput, 'content:write', { sort: { group: 1, sortOrder: 1 } });

adminContentRouter.get('/coupons/:id/redemptions', requirePermission('dashboard:read'), async (req, res) => {
  const { page, limit, skip } = pagination(req, 100, 25);
  const filter = { coupon: objectId(String(req.params.id)) };
  const [items, total] = await Promise.all([
    CouponRedemption.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('order', 'orderNumber pricing.total').lean(),
    CouponRedemption.countDocuments(filter),
  ]);
  res.json(paginated(items, total, page, limit));
});

/* ---------------------------------------------------------------- reviews */

async function refreshProductRating(productId: Types.ObjectId) {
  const [agg] = await Review.aggregate<{ avg: number; n: number }>([
    { $match: { product: productId, status: 'approved' } },
    { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
  ]);
  await Product.updateOne({ _id: productId }, { $set: { ratingAvg: agg?.avg ?? 0, ratingCount: agg?.n ?? 0 } });
}

adminContentRouter.get('/reviews', requirePermission('reviews:write'), async (req, res) => {
  const { page, limit, skip } = pagination(req, 100, 25);
  const filter: Record<string, unknown> = {};
  if (['pending', 'approved', 'rejected'].includes(String(req.query.status))) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('product', 'name slug').lean(),
    Review.countDocuments(filter),
  ]);
  res.json(paginated(items.map((r) => ({ ...r, id: String(r._id) })), total, page, limit));
});

adminContentRouter.patch('/reviews/:id', requirePermission('reviews:write'), async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']) }), req.body);
  const review = await Review.findByIdAndUpdate(objectId(String(req.params.id)), { $set: { status } }, { new: true });
  if (!review) throw notFound();
  await refreshProductRating(review.product);
  res.json({ ok: true });
});

adminContentRouter.delete('/reviews/:id', requirePermission('reviews:write'), async (req, res) => {
  const review = await Review.findByIdAndDelete(objectId(String(req.params.id)));
  if (!review) throw notFound();
  await refreshProductRating(review.product);
  res.json({ deleted: true });
});

/* -------------------------------------------------------------- enquiries */

adminContentRouter.get('/enquiries', requirePermission('enquiries:write'), async (req, res) => {
  const { page, limit, skip } = pagination(req, 100, 25);
  const filter: Record<string, unknown> = {};
  if ((ENQUIRY_TYPES as readonly string[]).includes(String(req.query.type))) filter.type = req.query.type;
  else filter.type = { $ne: 'newsletter' };
  if (['new', 'contacted', 'closed'].includes(String(req.query.status))) filter.status = req.query.status;
  const [items, total, newCount] = await Promise.all([
    Enquiry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('product', 'name slug').lean(),
    Enquiry.countDocuments(filter),
    Enquiry.countDocuments({ status: 'new', type: { $ne: 'newsletter' } }),
  ]);
  res.json({ ...paginated(items.map((e) => ({ ...e, id: String(e._id) })), total, page, limit), newCount });
});

adminContentRouter.patch('/enquiries/:id', requirePermission('enquiries:write'), async (req, res) => {
  const input = parse(z.object({ status: z.enum(['new', 'contacted', 'closed']).optional(), notes: z.string().max(2000).optional() }), req.body);
  const r = await Enquiry.updateOne({ _id: objectId(String(req.params.id)) }, { $set: input });
  if (!r.matchedCount) throw notFound();
  res.json({ ok: true });
});

/** Newsletter subscribers who explicitly opted in, as CSV. */
adminContentRouter.get('/subscribers.csv', requirePermission('settings:write'), async (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
  res.write('email,subscribed_at\n');
  const cursor = Enquiry.find({ type: 'newsletter', consent: true }).sort({ createdAt: 1 }).select('email createdAt').lean().cursor();
  for await (const s of cursor) res.write(`${csv(s.email)},${new Date(s.createdAt).toISOString()}\n`);
  res.end();
});

/** Quotes a CSV field and neutralises spreadsheet formula injection. */
export function csv(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
