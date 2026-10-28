import { Router } from 'express';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@goldshop/shared';
import { env } from '../../config/env';
import { badRequest } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { Enquiry, Order, Product, Review, User } from '../../models';
import { toOrderSummary } from '../../services/orders';
import { getSettings } from '../../services/settings';
import { csv } from './content';
import { orderFilter } from './orders';

export const adminReportsRouter = Router();

const TZ = 'Asia/Kolkata';
/** Averages are shown in whole rupees: paise round to the nearest rupee. */
const wholeRupees = (paise: number) => Math.round(paise / 100) * 100;

/** Orders that represent real sales (not unpaid, cancelled or under review). */
const SALE_STATUSES: OrderStatus[] = ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

function istDayStart(offsetDays = 0): Date {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const d = new Date(`${today}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

/** Days of daily sales the dashboard receives: enough for its 90-day chart and the previous 30 days. */
const DASHBOARD_DAYS = 90;

adminReportsRouter.get('/dashboard', requirePermission('dashboard:read'), async (_req, res) => {
  const since = istDayStart(-(DASHBOARD_DAYS - 1));
  const since30 = istDayStart(-29);
  const prev30 = istDayStart(-59);
  const since7 = istDayStart(-6);
  const prev7 = istDayStart(-13);
  const today = istDayStart(0);
  const yesterday = istDayStart(-1);

  const [series, statusCounts, lowStock, recent, newEnquiries, pendingReviews, settings, topProducts, oldestOpen] = await Promise.all([
    Order.aggregate<{ _id: string; revenue: number; orders: number }>([
      { $match: { status: { $in: SALE_STATUSES }, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
          revenue: { $sum: '$pricing.total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate<{ _id: OrderStatus; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Product.aggregate([
      { $match: { isActive: true } },
      { $unwind: '$variants' },
      { $match: { 'variants.isActive': true, 'variants.stock': { $lte: 2 } } },
      { $sort: { 'variants.stock': 1 } },
      { $limit: 8 },
      { $project: { name: 1, sku: '$variants.sku', label: '$variants.label', stock: '$variants.stock' } },
    ]),
    Order.find().sort({ createdAt: -1 }).limit(6).lean(),
    Enquiry.countDocuments({ status: 'new', type: { $ne: 'newsletter' } }),
    Review.countDocuments({ status: 'pending' }),
    getSettings(),
    Order.aggregate([
      { $match: { status: { $in: SALE_STATUSES }, createdAt: { $gte: since30 } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', name: { $first: '$items.name' }, image: { $first: '$items.image' }, units: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
    Order.findOne({ status: { $in: ['confirmed', 'processing'] } }).sort({ createdAt: 1 }).select('createdAt').lean(),
  ]);

  // Fill gaps so the chart has one bar per day.
  const byDay = new Map(series.map((s) => [s._id, s]));
  const days: { date: string; revenue: number; orders: number }[] = [];
  for (let i = 0; i < DASHBOARD_DAYS; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
    const hit = byDay.get(key);
    days.push({ date: key, revenue: hit?.revenue ?? 0, orders: hit?.orders ?? 0 });
  }
  /** Sales on days from `from` up to (not including) `until`. */
  const sum = (from: Date, until?: Date) =>
    days
      .filter((d) => {
        const at = new Date(`${d.date}T00:00:00+05:30`);
        return at >= from && (!until || at < until);
      })
      .reduce((acc, d) => ({ revenue: acc.revenue + d.revenue, orders: acc.orders + d.orders }), { revenue: 0, orders: 0 });

  const counts = Object.fromEntries(statusCounts.map((s) => [s._id, s.n]));
  const ratesAt = settings.goldRates?.updatedAt ? new Date(settings.goldRates.updatedAt) : null;

  res.json({
    today: sum(today),
    yesterday: sum(yesterday, today),
    last7: sum(since7),
    prev7: sum(prev7, since7),
    last30: sum(since30),
    prev30: sum(prev30, since30),
    series: days,
    statusCounts: counts,
    toFulfil: (counts.confirmed ?? 0) + (counts.processing ?? 0),
    oldestOpenAt: oldestOpen ? new Date(oldestOpen.createdAt).toISOString() : null,
    lowStock: lowStock.map((l) => ({ productId: String(l._id), name: l.name, sku: l.sku, label: l.label, stock: l.stock })),
    topProducts: topProducts.map((p) => ({ productId: String(p._id), name: p.name, image: p.image, units: p.units, revenue: p.revenue })),
    recentOrders: recent.map((o) => ({ ...toOrderSummary(o), customerName: o.customer.name, invoiceNumber: o.invoiceNumber || undefined })),
    pending: { enquiries: newEnquiries, reviews: pendingReviews, paymentReview: counts.payment_review ?? 0 },
    goldRatesUpdatedAt: ratesAt?.toISOString() ?? null,
    ratesStale: !ratesAt || Date.now() - ratesAt.getTime() > 24 * 3600_000,
    integrations: {
      razorpay: env.razorpay.enabled,
      razorpayWebhook: Boolean(env.razorpay.webhookSecret),
      email: env.smtp.enabled,
      cod: Boolean(settings.checkout?.codEnabled),
    },
  });
});

function parseRange(from: unknown, to: unknown) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const f = typeof from === 'string' && re.test(from) ? from : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(istDayStart(-29));
  const t = typeof to === 'string' && re.test(to) ? to : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const start = new Date(`${f}T00:00:00+05:30`);
  const end = new Date(`${t}T23:59:59.999+05:30`);
  if (end < start) throw badRequest('The end date must be after the start date.');
  if (end.getTime() - start.getTime() > 366 * 86400_000) throw badRequest('Choose a range of a year or less.');
  return { start, end, from: f, to: t };
}

adminReportsRouter.get('/reports/sales', requirePermission('reports:read'), async (req, res) => {
  const { start, end, from, to } = parseRange(req.query.from, req.query.to);
  const group = req.query.group === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const match = { status: { $in: SALE_STATUSES }, createdAt: { $gte: start, $lte: end } };

  const [series, totals, byPayment, topProducts, byCategory] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: group, date: '$createdAt', timezone: TZ } },
          revenue: { $sum: '$pricing.total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$pricing.total' },
          orders: { $sum: 1 },
          discount: { $sum: '$pricing.discount' },
          shipping: { $sum: '$pricing.shipping' },
          gst: { $sum: '$pricing.gstAmount' },
          refunded: { $sum: '$payment.amountRefunded' },
          units: { $sum: { $sum: '$items.qty' } },
        },
      },
    ]),
    Order.aggregate([
      { $match: match },
      { $group: { _id: '$payment.method', revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', name: { $first: '$items.name' }, units: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p', pipeline: [{ $project: { category: 1 } }] } },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'categories', localField: 'p.category', foreignField: '_id', as: 'c', pipeline: [{ $project: { name: 1 } }] } },
      { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ['$c.name', 'Uncategorised'] }, revenue: { $sum: '$items.lineTotal' }, units: { $sum: '$items.qty' } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const t = totals[0] ?? { revenue: 0, orders: 0, discount: 0, shipping: 0, gst: 0, refunded: 0, units: 0 };
  res.json({
    from,
    to,
    group: req.query.group === 'month' ? 'month' : 'day',
    totals: { ...t, _id: undefined, aov: t.orders ? wholeRupees(t.revenue / t.orders) : 0 },
    series: series.map((s) => ({ period: s._id, revenue: s.revenue, orders: s.orders })),
    byPayment: byPayment.map((p) => ({ method: p._id, revenue: p.revenue, orders: p.orders })),
    topProducts: topProducts.map((p) => ({ productId: String(p._id), name: p.name, units: p.units, revenue: p.revenue })),
    byCategory: byCategory.map((c) => ({ name: c._id, revenue: c.revenue, units: c.units })),
  });
});

adminReportsRouter.get('/reports/products', requirePermission('reports:read'), async (req, res) => {
  const { start, end, from, to } = parseRange(req.query.from, req.query.to);
  const match = { status: { $in: SALE_STATUSES }, createdAt: { $gte: start, $lte: end } };

  const [products, byPurity, byCategory, stock] = await Promise.all([
    Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $first: '$items.name' },
          image: { $first: '$items.image' },
          units: { $sum: '$items.qty' },
          revenue: { $sum: '$items.lineTotal' },
          orders: { $addToSet: '$_id' },
        },
      },
      { $project: { name: 1, image: 1, units: 1, revenue: 1, orders: { $size: '$orders' } } },
      { $sort: { revenue: -1 } },
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: { $ifNull: ['$items.purity', 'other'] },
          units: { $sum: '$items.qty' },
          revenue: { $sum: '$items.lineTotal' },
          weightMg: { $sum: { $multiply: [{ $ifNull: ['$items.netWeightMg', 0] }, '$items.qty'] } },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p', pipeline: [{ $project: { category: 1 } }] } },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'categories', localField: 'p.category', foreignField: '_id', as: 'c', pipeline: [{ $project: { name: 1 } }] } },
      { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ['$c.name', 'Uncategorised'] }, revenue: { $sum: '$items.lineTotal' }, units: { $sum: '$items.qty' } } },
      { $sort: { revenue: -1 } },
    ]),
    Product.aggregate<{ live: number; out: number; low: number }>([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          live: { $sum: 1 },
          out: { $sum: { $cond: [{ $lte: ['$totalStock', 0] }, 1, 0] } },
          low: { $sum: { $cond: [{ $and: [{ $gt: ['$totalStock', 0] }, { $lte: ['$totalStock', 2] }] }, 1, 0] } },
        },
      },
    ]),
  ]);

  // Live pieces that sold nothing in the period, oldest first: candidates for a push or a rethink.
  const unsold = await Product.find({ isActive: true, _id: { $nin: products.map((p) => p._id) } })
    .sort({ createdAt: 1 })
    .limit(10)
    .select('name images totalStock createdAt')
    .lean();

  const units = products.reduce((s, p) => s + p.units, 0);
  const revenue = products.reduce((s, p) => s + p.revenue, 0);
  const s = stock[0] ?? { live: 0, out: 0, low: 0 };
  res.json({
    from,
    to,
    totals: { units, revenue, productsSold: products.length, avgPrice: units ? wholeRupees(revenue / units) : 0, live: s.live, soldOut: s.out, lowStock: s.low },
    topProducts: products.slice(0, 20).map((p) => ({ productId: String(p._id), name: p.name, image: p.image, units: p.units, orders: p.orders, revenue: p.revenue })),
    byPurity: byPurity.map((p) => ({ purity: p._id, units: p.units, revenue: p.revenue, weightMg: p.weightMg })),
    byCategory: byCategory.map((c) => ({ name: c._id, revenue: c.revenue, units: c.units })),
    unsold: unsold.map((p) => ({ productId: String(p._id), name: p.name, image: p.images?.[0], stock: p.totalStock, listedAt: new Date(p.createdAt).toISOString() })),
  });
});

adminReportsRouter.get('/reports/customers', requirePermission('reports:read'), async (req, res) => {
  const { start, end, from, to } = parseRange(req.query.from, req.query.to);
  const match = { status: { $in: SALE_STATUSES }, createdAt: { $gte: start, $lte: end } };

  const [buyers, byState, signups] = await Promise.all([
    Order.aggregate<{ _id: string; name: string; phone: string; user: unknown; orders: number; revenue: number; lastAt: Date }>([
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $toLower: '$customer.email' },
          name: { $first: '$customer.name' },
          phone: { $first: '$customer.phone' },
          user: { $max: '$user' },
          orders: { $sum: 1 },
          revenue: { $sum: '$pricing.total' },
          lastAt: { $first: '$createdAt' },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
    Order.aggregate([
      { $match: match },
      { $group: { _id: '$shippingAddress.state', orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' }, customers: { $addToSet: { $toLower: '$customer.email' } } } },
      { $project: { orders: 1, revenue: 1, customers: { $size: '$customers' } } },
      { $sort: { revenue: -1 } },
      { $limit: 12 },
    ]),
    User.countDocuments({ role: 'customer', createdAt: { $gte: start, $lte: end } }),
  ]);

  // Returning = bought before this period too.
  const emails = buyers.map((b) => b._id);
  const returningEmails = emails.length
    ? new Set(
        (await Order.distinct('customer.email', { status: { $in: SALE_STATUSES }, createdAt: { $lt: start }, 'customer.email': { $in: emails } })).map((e) =>
          String(e).toLowerCase(),
        ),
      )
    : new Set<string>();

  const revenue = buyers.reduce((s, b) => s + b.revenue, 0);
  const orders = buyers.reduce((s, b) => s + b.orders, 0);
  const registered = buyers.filter((b) => b.user).length;
  res.json({
    from,
    to,
    totals: {
      customers: buyers.length,
      newCustomers: buyers.length - returningEmails.size,
      returningCustomers: returningEmails.size,
      repeatInPeriod: buyers.filter((b) => b.orders > 1).length,
      signups,
      registered,
      guests: buyers.length - registered,
      revenue,
      orders,
      avgSpend: buyers.length ? wholeRupees(revenue / buyers.length) : 0,
    },
    topCustomers: buyers.slice(0, 20).map((b) => ({
      email: b._id,
      name: b.name,
      phone: b.phone,
      userId: b.user ? String(b.user) : undefined,
      orders: b.orders,
      revenue: b.revenue,
      lastOrderAt: new Date(b.lastAt).toISOString(),
      returning: returningEmails.has(b._id),
    })),
    byState: byState.map((s) => ({ state: s._id || 'Unknown', orders: s.orders, revenue: s.revenue, customers: s.customers })),
  });
});

adminReportsRouter.get('/reports/orders.csv', requirePermission('reports:read'), async (req, res) => {
  const { start, end, from, to } = parseRange(req.query.from, req.query.to);
  const filter = { ...orderFilter(req.query as Record<string, unknown>), createdAt: { $gte: start, $lte: end } };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${from}-to-${to}.csv"`);
  res.write(
    'order_number,invoice_number,date,status,customer,email,phone,city,state,pincode,items,subtotal,discount,shipping,cod_fee,total,taxable_value,cgst,sgst,igst,payment_method,payment_status,coupon\n',
  );
  const rupees = (p: number) => (p / 100).toFixed(2);
  const cursor = Order.find(filter).sort({ createdAt: 1 }).limit(20_000).lean().cursor();
  for await (const o of cursor) {
    const row = [
      o.orderNumber,
      o.invoiceNumber ?? '',
      new Date(o.createdAt).toLocaleString('en-IN', { timeZone: TZ }),
      ORDER_STATUS_LABELS[o.status],
      o.customer.name,
      o.customer.email,
      o.customer.phone,
      o.shippingAddress.city,
      o.shippingAddress.state,
      o.shippingAddress.pincode,
      o.items.map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} x${i.qty}`).join('; '),
      rupees(o.pricing.subtotal),
      rupees(o.pricing.discount),
      rupees(o.pricing.shipping),
      rupees(o.pricing.codFee),
      rupees(o.pricing.total),
      rupees(o.pricing.taxableValue),
      rupees(o.pricing.cgst),
      rupees(o.pricing.sgst),
      rupees(o.pricing.igst),
      o.payment.method,
      o.payment.status,
      o.coupon?.code ?? '',
    ];
    res.write(`${row.map(csv).join(',')}\n`);
  }
  res.end();
});
