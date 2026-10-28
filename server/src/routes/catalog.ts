import { Router } from 'express';
import { Types } from 'mongoose';
import {
  PURITY_KEYS,
  imageUrl,
  reviewSchema,
  type BannerDTO,
  type CollectionDTO,
  type GoldRateHistoryDTO,
  type GoldRatesDTO,
  type CategoryNode,
  type HomeCircle,
  type ImageRef,
  type HomeDTO,
  type PurityKey,
  type PostSummaryDTO,
  type ReviewsResponse,
  type SearchSuggestions,
  type TestimonialDTO,
} from '@goldshop/shared';
import { cached } from '../lib/cache';
import { conflict, forbidden, notFound } from '../lib/errors';
import { escapeRegex, paginated, pagination, parse } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { Banner, Category, Collection, GoldRateLog, Order, Post, Product, Review, Testimonial } from '../models';
import {
  badgeRules,
  categoryRefMap,
  categoryTree,
  toProductCard,
  toProductDetail,
  type LeanProduct,
  type PricingContext,
} from '../services/catalog';
import { listProducts, parseListParams, relatedProducts } from '../services/productQuery';
import { getSettings, ratesFrom, scriptLines, toPublicSettings } from '../services/settings';

export const catalogRouter = Router();

async function pricingContext(): Promise<PricingContext> {
  const s = await getSettings();
  return { rates: ratesFrom(s), gstRateBps: s.tax?.gstRateBps ?? 300 };
}

export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 220));
}

export function toPostSummary(p: {
  _id: unknown; title: string; slug: string; excerpt?: string; body?: string; cover?: unknown;
  publishedAt?: Date | null; createdAt?: Date; tags?: string[];
}): PostSummaryDTO {
  const cover = p.cover as PostSummaryDTO['cover'];
  return {
    id: String(p._id),
    title: p.title,
    slug: p.slug,
    excerpt: p.excerpt ?? '',
    cover: cover?.key || cover?.url ? cover : undefined,
    publishedAt: new Date(p.publishedAt ?? p.createdAt ?? Date.now()).toISOString(),
    readingMinutes: readingMinutes(p.body ?? ''),
    tags: p.tags ?? [],
  };
}

type LeanCollection = {
  _id: unknown;
  name: string;
  slug: string;
  eyebrow?: string | null;
  tagline?: string | null;
  description?: string | null;
  image?: unknown;
  banner?: unknown;
  isFeatured?: boolean | null;
};
const usable = (img: unknown) => {
  const i = img as ImageRef | null | undefined;
  return i?.key || i?.url ? i : undefined;
};

export function toCollectionDTO(c: LeanCollection): CollectionDTO {
  return {
    id: String(c._id),
    name: c.name,
    slug: c.slug,
    eyebrow: c.eyebrow || undefined,
    tagline: c.tagline || undefined,
    description: c.description || undefined,
    image: usable(c.image),
    banner: usable(c.banner),
    isFeatured: Boolean(c.isFeatured),
  };
}

catalogRouter.get('/settings', async (_req, res) => {
  const settings = await getSettings();
  // Revalidate every time (a cheap 304 via the ETag) so an admin's saved changes show on the very next page.
  res.set('Cache-Control', 'no-cache');
  res.json(toPublicSettings(settings));
});

/** The gold lotus line drawing, for the opening screen of a store that hasn't uploaded a logo yet. */
const LOTUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" fill="none" stroke="#a57a2c" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><path d="M32 4c5 6 7 12 7 18s-3 12-7 16c-4-4-7-10-7-16s2-12 7-18Z"/><path d="M25 22c-6-4-12-5-17-4 1 8 6 15 15 18 3 1 6 1 9 0"/><path d="M39 22c6-4 12-5 17-4-1 8-6 15-15 18-3 1-6 1-9 0"/><path d="M20 31c-6 0-11 2-14 5 5 4 12 6 20 4"/><path d="M44 31c6 0 11 2 14 5-5 4-12 6-20 4"/><path d="M20 45h24"/></svg>`;

/**
 * The store's logo at a fixed address, for the opening screen in index.html — which shows before
 * the app (and so the settings) has loaded. Always an image: the uploaded logo, or the lotus.
 */
catalogRouter.get('/brand/logo', async (_req, res) => {
  const logo = (await getSettings()).brand?.logo;
  // Short-lived, so a newly uploaded logo appears within minutes; the image file itself is cached for good.
  res.set('Cache-Control', 'public, max-age=300');
  if (logo?.key || logo?.url) {
    res.redirect(302, imageUrl(logo, 960));
    return;
  }
  res.type('image/svg+xml').send(LOTUS_SVG);
});

/**
 * Rates for the gold-rate page. The 24-hour comparison comes from the rate history (the snapshot
 * that was in force exactly a day ago); without that history no change is reported at all.
 */
catalogRouter.get('/gold-rates', async (_req, res) => {
  const data = await cached('public:gold-rates', 60_000, async (): Promise<GoldRatesDTO> => {
    const s = await getSettings();
    const rates = ratesFrom(s);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const then = await GoldRateLog.findOne({ createdAt: { $lte: dayAgo } }).sort({ createdAt: -1 }).lean();
    const thenRates = (then?.rates ?? {}) as Record<string, number | null | undefined>;
    const previous = Object.fromEntries(
      Object.keys(rates).flatMap((k) => {
        const v = thenRates[k];
        return typeof v === 'number' && v > 0 ? [[k, v]] : [];
      }),
    );
    const page = s.goldRatePage;
    return {
      rates,
      updatedAt: s.goldRates?.updatedAt ? new Date(s.goldRates.updatedAt).toISOString() : undefined,
      previous: Object.keys(previous).length ? previous : undefined,
      page: {
        image: page?.image?.key || page?.image?.url ? page.image : undefined,
        script: scriptLines(page?.script ?? ''),
        highlights: (page?.highlights ?? []).filter((h) => h.title),
        purityImages: Object.fromEntries(
          PURITY_KEYS.flatMap((k) => {
            const img = page?.purityImages?.[k];
            return img?.key || img?.url ? [[k, img]] : [];
          }),
        ),
      },
    };
  });
  res.set('Cache-Control', 'public, max-age=30');
  res.json(data);
});

/**
 * The rates the store has set over a period (7–365 days, default 90), from the rate log. The rate
 * that was in force when the period began comes first, so the trend starts from a real value; with
 * nothing logged yet, the current rate is the only point.
 */
catalogRouter.get('/gold-rates/history', async (req, res) => {
  const days = Math.min(Math.max(Math.round(Number(req.query.days)) || 90, 7), 365);
  const data = await cached(`public:gold-rate-history:${days}`, 60_000, async (): Promise<GoldRateHistoryDTO> => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [before, during, s] = await Promise.all([
      GoldRateLog.findOne({ createdAt: { $lt: since } }).sort({ createdAt: -1 }).select('createdAt rates').lean(),
      GoldRateLog.find({ createdAt: { $gte: since } }).sort({ createdAt: 1 }).limit(500).select('createdAt rates').lean(),
      getSettings(),
    ]);
    const clean = (r: unknown) => Object.fromEntries(Object.entries((r ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && v > 0)) as Partial<Record<PurityKey, number>>;
    const points = [...(before ? [before] : []), ...during].map((l) => ({ at: new Date((l as { createdAt: Date }).createdAt).toISOString(), rates: clean(l.rates) }));
    if (points.length === 0 && s.goldRates?.updatedAt) points.push({ at: new Date(s.goldRates.updatedAt).toISOString(), rates: ratesFrom(s) });
    return { since: since.toISOString(), points };
  });
  res.set('Cache-Control', 'public, max-age=30');
  res.json(data);
});

/**
 * The homepage circles the store chose, in its order. A category or collection that no longer
 * exists, is switched off, or has no pieces yet is left out, so no circle leads to an empty page.
 * Undefined until the store has chosen any, when the page shows every category with pieces.
 */
async function resolveCircles(tree: CategoryNode[]): Promise<HomeCircle[] | undefined> {
  const chosen = (await getSettings()).homePage?.circles ?? [];
  if (chosen.length === 0) return undefined;
  const cats = new Map(tree.flatMap((c) => [c, ...c.children]).map((c) => [c.slug, c]));
  const colSlugs = chosen.filter((c) => c.kind === 'collection').map((c) => c.ref);
  const cols = colSlugs.length ? await Collection.find({ isActive: true, slug: { $in: colSlugs } }).select('name slug image').lean() : [];
  const own = (img?: ImageRef | null) => (img?.key || img?.url ? img : undefined);
  return chosen.flatMap((c): HomeCircle[] => {
    if (c.kind === 'category') {
      const cat = cats.get(c.ref);
      if (!cat || !cat.productCount) return [];
      return [{ label: c.label || cat.name, href: `/shop/${cat.slug}`, image: own(c.image) ?? cat.image }];
    }
    if (c.kind === 'collection') {
      const col = cols.find((x) => x.slug === c.ref);
      if (!col) return [];
      return [{ label: c.label || col.name, href: `/collections/${col.slug}`, image: own(c.image) ?? own(col.image as ImageRef | null) }];
    }
    return c.label && c.href ? [{ label: c.label, href: c.href, image: own(c.image) }] : [];
  });
}

catalogRouter.get('/home', async (_req, res) => {
  const data = await cached('public:home', 60_000, async (): Promise<HomeDTO> => {
    const ctx = await pricingContext();
    const now = new Date();
    const cardFields = '-description';
    const [banners, categories, collections, featured, bestsellers, newArrivals, testimonials, posts, catMap] = await Promise.all([
      Banner.find({
        isActive: true,
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] },
        ],
      })
        .sort({ sortOrder: 1 })
        .limit(5)
        .lean(),
      categoryTree(true),
      Collection.find({ isActive: true }).sort({ isFeatured: -1, sortOrder: 1 }).limit(6).lean(),
      Product.find({ isActive: true, isFeatured: true }).sort({ inStock: -1, sortOrder: 1, createdAt: -1 }).limit(8).select(cardFields).lean<LeanProduct[]>(),
      // Bestsellers are based on real sales only; with no sales yet the section stays hidden.
      Product.find({ isActive: true, soldCount: { $gt: 0 } }).sort({ soldCount: -1 }).limit(8).select(cardFields).lean<LeanProduct[]>(),
      Product.find({ isActive: true }).sort({ createdAt: -1 }).limit(8).select(cardFields).lean<LeanProduct[]>(),
      Testimonial.find({ isPublished: true }).sort({ sortOrder: 1, createdAt: -1 }).limit(9).lean(),
      Post.find({ isPublished: true }).sort({ publishedAt: -1 }).limit(3).lean(),
      categoryRefMap(),
    ]);
    return {
      banners: banners.map(
        (b): BannerDTO => ({
          id: String(b._id),
          eyebrow: b.eyebrow || undefined,
          title: b.title,
          subtitle: b.subtitle || undefined,
          ctaLabel: b.ctaLabel || undefined,
          ctaHref: b.ctaHref || undefined,
          secondaryLabel: b.secondaryLabel || undefined,
          secondaryHref: b.secondaryHref || undefined,
          image: b.image?.key || b.image?.url ? (b.image as BannerDTO['image']) : undefined,
          mobileImage: b.mobileImage?.key || b.mobileImage?.url ? (b.mobileImage as BannerDTO['image']) : undefined,
          script: b.script ? scriptLines(b.script) : undefined,
          points: b.points ? scriptLines(b.points, 3) : undefined,
          theme: b.theme as BannerDTO['theme'],
          align: b.align as BannerDTO['align'],
          layout: (b.layout as BannerDTO['layout']) ?? 'split',
        }),
      ),
      categories,
      circles: await resolveCircles(categories),
      collections: collections.map(toCollectionDTO),
      featured: featured.map((p) => toProductCard(p, ctx, catMap)),
      bestsellers: bestsellers.map((p) => toProductCard(p, ctx, catMap)),
      newArrivals: newArrivals.map((p) => toProductCard(p, ctx, catMap)),
      testimonials: testimonials.map(
        (t): TestimonialDTO => ({
          id: String(t._id),
          name: t.name,
          location: t.location || undefined,
          quote: t.quote,
          rating: t.rating ?? undefined,
          source: t.source || undefined,
        }),
      ),
      posts: posts.map(toPostSummary),
    };
  });
  res.json(data);
});

catalogRouter.get('/categories', async (_req, res) => {
  res.json(await categoryTree(true));
});

catalogRouter.get('/categories/:slug', async (req, res) => {
  const cat = await Category.findOne({ slug: req.params.slug, isActive: true }).lean();
  if (!cat) throw notFound('Category not found.');
  const tree = await categoryTree(true);
  const find = (nodes: typeof tree): (typeof tree)[number] | undefined => {
    for (const n of nodes) {
      if (n.slug === cat.slug) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
  };
  const node = find(tree);
  const parent = cat.parent ? await Category.findById(cat.parent).select('name slug').lean() : null;
  res.json({
    ...node,
    seo: cat.seo,
    parent: parent ? { id: String(parent._id), name: parent.name, slug: parent.slug } : undefined,
  });
});

catalogRouter.get('/collections', async (_req, res) => {
  const items = await cached('public:collections', 60_000, () =>
    Collection.find({ isActive: true }).sort({ isFeatured: -1, sortOrder: 1 }).lean(),
  );
  res.json(
    items.map(toCollectionDTO),
  );
});

catalogRouter.get('/collections/:slug', async (req, res) => {
  const c = await Collection.findOne({ slug: req.params.slug, isActive: true }).lean();
  if (!c) throw notFound('Collection not found.');
  res.json({ ...toCollectionDTO(c), seo: c.seo });
});

catalogRouter.get('/products', async (req, res) => {
  const params = parseListParams(req.query as Record<string, unknown>);
  res.json(await listProducts(params, await pricingContext()));
});

catalogRouter.get('/products/:slug', async (req, res) => {
  const product = await Product.findOne({ slug: String(req.params.slug).toLowerCase(), isActive: true }).lean<LeanProduct>();
  if (!product) throw notFound('We could not find that piece.');
  const settings = await getSettings();
  const ctx = { rates: ratesFrom(settings), gstRateBps: settings.tax?.gstRateBps ?? 300 };
  res.json(await toProductDetail(product, ctx, settings.goldRates?.updatedAt));
});

catalogRouter.get('/products/:slug/related', async (req, res) => {
  const product = await Product.findOne({ slug: String(req.params.slug).toLowerCase(), isActive: true })
    .select('category categoryPath collections')
    .lean<LeanProduct>();
  if (!product) throw notFound();
  res.json(await relatedProducts(product, await pricingContext()));
});

/** Batch lookup for recently-viewed and wishlist (guest) rails. */
catalogRouter.get('/products-by-ids', async (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .filter((id) => /^[a-f0-9]{24}$/i.test(id))
    .slice(0, 24);
  if (!ids.length) return void res.json([]);
  const [docs, ctx, catMap, rules] = await Promise.all([
    Product.find({ _id: { $in: ids }, isActive: true }).select('-description').lean<LeanProduct[]>(),
    pricingContext(),
    categoryRefMap(),
    badgeRules(),
  ]);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  res.json(ids.map((id) => byId.get(id)).filter(Boolean).map((d) => toProductCard(d!, ctx, catMap, rules)));
});

catalogRouter.get('/search/suggest', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  if (q.length < 2) return void res.json({ products: [], categories: [], collections: [] } satisfies SearchSuggestions);
  const rx = new RegExp(`(^|\\s|-)${escapeRegex(q)}`, 'i');
  const [products, categories, collections, ctx] = await Promise.all([
    Product.find({ isActive: true, $or: [{ name: rx }, { tags: rx }] })
      .sort({ inStock: -1, soldCount: -1 })
      .limit(6)
      .select('name slug images purity pricingMode making makingDiscountPercent variants isActive')
      .lean<LeanProduct[]>(),
    Category.find({ isActive: true, name: rx }).limit(4).select('name slug').lean(),
    Collection.find({ isActive: true, name: rx }).limit(3).select('name slug').lean(),
    pricingContext(),
  ]);
  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    products: products.map((p) => {
      const card = toProductCard(p, ctx);
      return { id: card.id, slug: card.slug, name: card.name, image: card.image, price: card.price, purity: card.purity };
    }),
    categories: categories.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug })),
    collections: collections.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug })),
  } satisfies SearchSuggestions);
});

/* --------------------------------------------------------------- reviews */

async function deliveredOrderFor(userId: string, productId: Types.ObjectId) {
  return Order.findOne({ user: userId, status: 'delivered', 'items.product': productId }).select('_id').lean();
}

catalogRouter.get('/products/:slug/reviews', async (req, res) => {
  const product = await Product.findOne({ slug: String(req.params.slug).toLowerCase(), isActive: true })
    .select('_id ratingAvg ratingCount')
    .lean();
  if (!product) throw notFound();
  const { page, limit, skip } = pagination(req, 20, 6);
  const filter = { product: product._id, status: 'approved' };
  const [items, total, dist] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Review.countDocuments(filter),
    Review.aggregate<{ _id: number; n: number }>([{ $match: filter }, { $group: { _id: '$rating', n: { $sum: 1 } } }]),
  ]);
  let canReview = false;
  if (req.user) {
    const [order, existing] = await Promise.all([
      deliveredOrderFor(req.user.id, product._id),
      Review.exists({ product: product._id, user: req.user.id }),
    ]);
    canReview = Boolean(order) && !existing;
  }
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as ReviewsResponse['distribution'];
  for (const d of dist) distribution[d._id as 1 | 2 | 3 | 4 | 5] = d.n;
  const body: ReviewsResponse = {
    ...paginated(
      items.map((r) => ({
        id: String(r._id),
        rating: r.rating,
        title: r.title || undefined,
        body: r.body,
        authorName: r.authorName,
        createdAt: r.createdAt.toISOString(),
        verifiedPurchase: true,
      })),
      total,
      page,
      limit,
    ),
    ratingAvg: Math.round((product.ratingAvg ?? 0) * 10) / 10,
    ratingCount: product.ratingCount ?? 0,
    distribution,
    canReview,
  };
  res.json(body);
});

catalogRouter.post('/products/:slug/reviews', requireAuth, async (req, res) => {
  const input = parse(reviewSchema, req.body);
  const product = await Product.findOne({ slug: String(req.params.slug).toLowerCase(), isActive: true }).select('_id').lean();
  if (!product) throw notFound();
  const order = await deliveredOrderFor(req.user!.id, product._id);
  if (!order) throw forbidden('Reviews can be written once your order of this piece has been delivered.');
  if (await Review.exists({ product: product._id, user: req.user!.id })) throw conflict("You've already reviewed this piece.");
  const firstName = req.user!.name.split(' ')[0];
  const lastInitial = req.user!.name.split(' ').slice(1).join(' ').charAt(0);
  await Review.create({
    product: product._id,
    user: req.user!.id,
    order: order._id,
    authorName: lastInitial ? `${firstName} ${lastInitial}.` : firstName,
    rating: input.rating,
    title: input.title,
    body: input.body,
    status: 'pending',
  });
  res.status(201).json({ ok: true, message: 'Thank you! Your review will appear once it has been checked.' });
});
