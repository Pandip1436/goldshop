import { Types } from 'mongoose';
import {
  MAX_QTY_PER_LINE,
  type CategoryNode,
  type CategoryRef,
  type ImageRef,
  type ProductCardDTO,
  type ProductDetailDTO,
  type VariantDTO,
} from '@goldshop/shared';
import { cached } from '../lib/cache';
import { Category, Collection, Product, type IProduct, type IVariant } from '../models';
import { priceVariant, type Rates } from './pricing';

export type LeanVariant = IVariant;
export type LeanProduct = Omit<IProduct, 'variants'> & { _id: Types.ObjectId; variants: LeanVariant[] };

const LOW_STOCK_THRESHOLD = 3;

export interface PricingContext {
  rates: Rates;
  gstRateBps: number;
}

function cleanImage(img?: ImageRef | null): ImageRef | undefined {
  if (!img || (!img.key && !img.url)) return undefined;
  return { key: img.key, url: img.url || undefined, alt: img.alt ?? '', width: img.width ?? 0, height: img.height ?? 0 };
}

/** Recomputes cached prices and stock flags. Call before saving a product or after rates change. */
export function applyDerivedFields(p: Pick<IProduct, 'pricingMode' | 'purity' | 'making' | 'makingDiscountPercent'> & {
  variants: Array<Pick<IVariant, 'netWeightMg' | 'stoneCharge' | 'fixedPrice' | 'stock' | 'isActive' | 'priceCache'>>;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  totalStock?: number;
}, ctx: PricingContext): void {
  let min = Infinity;
  let max = 0;
  let stock = 0;
  for (const v of p.variants) {
    const price = priceVariant(p, v, ctx.rates, ctx.gstRateBps);
    v.priceCache = price?.total ?? 0;
    if (!v.isActive) continue;
    stock += Math.max(0, v.stock ?? 0);
    if (price) {
      min = Math.min(min, price.total);
      max = Math.max(max, price.total);
    }
  }
  p.minPrice = Number.isFinite(min) ? min : 0;
  p.maxPrice = max;
  p.totalStock = stock;
  p.inStock = stock > 0 && p.minPrice > 0;
}

/** Re-prices every product after a gold-rate change, in bounded batches. */
export async function repriceAllProducts(ctx: PricingContext): Promise<number> {
  let count = 0;
  const cursor = Product.find({ pricingMode: 'weight' })
    .select('pricingMode purity making makingDiscountPercent variants')
    .lean<LeanProduct[]>()
    .cursor({ batchSize: 200 });
  let ops: Parameters<typeof Product.bulkWrite>[0] = [];
  for await (const doc of cursor) {
    const p = doc as unknown as LeanProduct;
    applyDerivedFields(p, ctx);
    ops.push({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: {
            variants: p.variants,
            minPrice: p.minPrice,
            maxPrice: p.maxPrice,
            inStock: p.inStock,
            totalStock: p.totalStock,
          },
        },
      },
    });
    if (ops.length >= 200) {
      await Product.bulkWrite(ops, { ordered: false });
      count += ops.length;
      ops = [];
    }
  }
  if (ops.length) {
    await Product.bulkWrite(ops, { ordered: false });
    count += ops.length;
  }
  return count;
}

export interface BadgeRules {
  /** At least this many real sales earns "Bestseller". */
  bestsellerMinSold: number;
  /** Added on or after this date earns "New". */
  newSince: Date;
}

const BADGE_TOP = 8;
const BADGE_MIN_SALES = 3;
const NEW_WITHIN_DAYS = 30;

/**
 * Thresholds for card badges, from real data: "Bestseller" means among the top sellers with at
 * least a few actual sales; "New" means among the most recent additions and added within a month.
 */
export function badgeRules(): Promise<BadgeRules> {
  return cached('public:badge-rules', 5 * 60_000, async () => {
    const [sellers, newest] = await Promise.all([
      Product.find({ isActive: true, soldCount: { $gt: 0 } }).sort({ soldCount: -1 }).skip(BADGE_TOP - 1).limit(1).select('soldCount').lean(),
      Product.find({ isActive: true }).sort({ createdAt: -1 }).skip(BADGE_TOP - 1).limit(1).select('createdAt').lean(),
    ]);
    const monthAgo = new Date(Date.now() - NEW_WITHIN_DAYS * 86_400_000);
    const nth = newest[0]?.createdAt ? new Date(newest[0].createdAt) : monthAgo;
    return {
      bestsellerMinSold: Math.max(BADGE_MIN_SALES, sellers[0]?.soldCount ?? 0),
      newSince: nth > monthAgo ? nth : monthAgo,
    };
  });
}

export function toProductCard(p: LeanProduct, ctx: PricingContext, categories?: Map<string, CategoryRef>, rules?: BadgeRules): ProductCardDTO {
  const active = p.variants.filter((v) => v.isActive);
  const priced = active
    .map((v) => ({ v, price: priceVariant(p, v, ctx.rates, ctx.gstRateBps) }))
    .filter((x) => x.price !== null) as { v: LeanVariant; price: NonNullable<ReturnType<typeof priceVariant>> }[];
  const inStockPriced = priced.filter((x) => x.v.stock > 0);
  const pool = inStockPriced.length ? inStockPriced : priced;
  const cheapest = pool.reduce<(typeof pool)[number] | undefined>(
    (best, x) => (!best || x.price.total < best.price.total ? x : best),
    undefined,
  );
  const prices = new Set(priced.map((x) => x.price.total));
  const purchasable = priced.filter((x) => x.v.stock > 0);
  const compareAt = p.pricingMode === 'fixed' && cheapest && cheapest.v.compareAtPrice > cheapest.price.total
    ? cheapest.v.compareAtPrice
    : undefined;

  return {
    id: String(p._id),
    slug: p.slug,
    name: p.name,
    image: cleanImage(p.images?.[0]),
    hoverImage: cleanImage(p.images?.[1]),
    purity: p.purity ?? undefined,
    weightMg: cheapest?.v.netWeightMg || undefined,
    price: cheapest?.price.total ?? 0,
    priceFrom: prices.size > 1,
    compareAtPrice: compareAt,
    inStock: purchasable.length > 0,
    makingDiscountPercent: p.pricingMode === 'weight' ? p.makingDiscountPercent ?? 0 : 0,
    ratingAvg: Math.round((p.ratingAvg ?? 0) * 10) / 10,
    ratingCount: p.ratingCount ?? 0,
    category: categories?.get(String(p.category)),
    quickAddVariantId: active.length === 1 && purchasable.length === 1 ? String(active[0]._id) : undefined,
    badges: rules ? badgesFor(p, rules) : undefined,
  };
}

function badgesFor(p: LeanProduct, rules: BadgeRules): ProductCardDTO['badges'] {
  const out: NonNullable<ProductCardDTO['badges']> = [];
  if ((p.soldCount ?? 0) >= rules.bestsellerMinSold) out.push('bestseller');
  if (p.createdAt && new Date(p.createdAt) >= rules.newSince) out.push('new');
  return out.length ? out : undefined;
}

export function toVariantDTO(p: LeanProduct, v: LeanVariant, ctx: PricingContext): VariantDTO | null {
  const price = priceVariant(p, v, ctx.rates, ctx.gstRateBps);
  if (!price) return null;
  const stock = Math.max(0, v.stock ?? 0);
  return {
    id: String(v._id),
    sku: v.sku,
    label: v.label,
    attributes: v.attributes ?? {},
    netWeightMg: v.netWeightMg || undefined,
    grossWeightMg: v.grossWeightMg || undefined,
    inStock: stock > 0,
    available: Math.min(stock, MAX_QTY_PER_LINE),
    lowStock: stock > 0 && stock <= LOW_STOCK_THRESHOLD ? stock : undefined,
    price,
    compareAtPrice: p.pricingMode === 'fixed' && v.compareAtPrice > price.total ? v.compareAtPrice : undefined,
  };
}

export async function toProductDetail(p: LeanProduct, ctx: PricingContext, goldRatesUpdatedAt?: Date): Promise<ProductDetailDTO> {
  const [categoryMap, collections, rules] = await Promise.all([
    categoryRefMap(),
    p.collections?.length
      ? Collection.find({ _id: { $in: p.collections }, isActive: true }).select('name slug').lean()
      : Promise.resolve([]),
    badgeRules(),
  ]);
  const card = toProductCard(p, ctx, categoryMap, rules);
  const path = await categoryPath(p.category);
  const variants = p.variants
    .filter((v) => v.isActive)
    .map((v) => toVariantDTO(p, v, ctx))
    .filter((v): v is VariantDTO => v !== null);

  return {
    ...card,
    shortDescription: p.shortDescription ?? '',
    description: p.description ?? '',
    images: (p.images ?? []).map(cleanImage).filter((x): x is ImageRef => Boolean(x)),
    categoryPath: path,
    collections: collections.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug })),
    specs: (p.specs ?? []).filter((s) => s.label && s.value),
    variants,
    optionNames: p.optionNames ?? [],
    pricingMode: p.pricingMode,
    making: p.pricingMode === 'weight' && p.making ? { type: p.making.type, value: p.making.value } : undefined,
    tags: p.tags ?? [],
    goldRatesUpdatedAt: goldRatesUpdatedAt ? new Date(goldRatesUpdatedAt).toISOString() : undefined,
    seo: p.seo?.title || p.seo?.description ? { title: p.seo.title, description: p.seo.description } : undefined,
  };
}

interface LeanCategory {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  parent?: Types.ObjectId | null;
  description?: string;
  image?: ImageRef;
  sortOrder: number;
  isActive: boolean;
}

export async function allActiveCategories(): Promise<LeanCategory[]> {
  return cached('public:categories:raw', 60_000, () =>
    Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean<LeanCategory[]>(),
  );
}

export async function categoryRefMap(): Promise<Map<string, CategoryRef>> {
  const cats = await allActiveCategories();
  return new Map(cats.map((c) => [String(c._id), { id: String(c._id), name: c.name, slug: c.slug }]));
}

/** Root-to-leaf path for breadcrumbs. */
export async function categoryPath(categoryId: Types.ObjectId | string | null | undefined): Promise<CategoryRef[]> {
  if (!categoryId) return [];
  const all = await Category.find().select('name slug parent').lean<LeanCategory[]>();
  const byId = new Map(all.map((c) => [String(c._id), c]));
  const path: CategoryRef[] = [];
  let current = byId.get(String(categoryId));
  let guard = 0;
  while (current && guard++ < 10) {
    path.unshift({ id: String(current._id), name: current.name, slug: current.slug });
    current = current.parent ? byId.get(String(current.parent)) : undefined;
  }
  return path;
}

/** All ancestor ids including the category itself, used to populate Product.categoryPath. */
export async function categoryLineage(categoryId: Types.ObjectId | string): Promise<Types.ObjectId[]> {
  return (await categoryPath(categoryId)).map((c) => new Types.ObjectId(c.id));
}

export async function categoryTree(withCounts = false): Promise<CategoryNode[]> {
  return cached(`public:categories:tree:${withCounts}`, 60_000, async () => {
    const cats = await allActiveCategories();
    const counts = new Map<string, number>();
    if (withCounts) {
      const agg = await Product.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { isActive: true } },
        { $unwind: '$categoryPath' },
        { $group: { _id: '$categoryPath', n: { $sum: 1 } } },
      ]);
      for (const a of agg) counts.set(String(a._id), a.n);
    }
    const nodes = new Map<string, CategoryNode>();
    for (const c of cats) {
      nodes.set(String(c._id), {
        id: String(c._id),
        name: c.name,
        slug: c.slug,
        description: c.description || undefined,
        image: cleanImage(c.image),
        productCount: withCounts ? counts.get(String(c._id)) ?? 0 : undefined,
        children: [],
      });
    }
    const roots: CategoryNode[] = [];
    for (const c of cats) {
      const node = nodes.get(String(c._id))!;
      const parent = c.parent ? nodes.get(String(c.parent)) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  });
}
