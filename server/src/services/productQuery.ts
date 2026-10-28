import type { FilterQuery, SortOrder, Types } from 'mongoose';
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PRODUCT_SORTS,
  PURITY_KEYS,
  type ProductListResponse,
  type ProductSort,
  type PurityKey,
} from '@goldshop/shared';
import { cached } from '../lib/cache';
import { escapeRegex } from '../lib/http';
import { Category, Collection, Product, type IProduct } from '../models';
import { badgeRules, categoryRefMap, toProductCard, type LeanProduct, type PricingContext } from './catalog';

export interface ListParams {
  q?: string;
  category?: string;
  collection?: string;
  purity?: string[];
  /** Rupees, as typed in the price filter. */
  min?: number;
  max?: number;
  inStock?: boolean;
  tag?: string;
  sort?: ProductSort;
  page: number;
  limit: number;
}

const SORTS: Record<ProductSort, Record<string, SortOrder>> = {
  featured: { isFeatured: -1, sortOrder: 1, createdAt: -1 },
  popular: { soldCount: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  price_asc: { minPrice: 1 },
  price_desc: { minPrice: -1 },
  rating: { ratingAvg: -1, ratingCount: -1 },
};

export function parseListParams(query: Record<string, unknown>): ListParams {
  const str = (k: string, max = 80) => (typeof query[k] === 'string' && query[k] ? String(query[k]).trim().slice(0, max) : undefined);
  const num = (k: string) => {
    const v = Number.parseInt(String(query[k] ?? ''), 10);
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const sort = str('sort') as ProductSort | undefined;
  const purity = (str('purity', 200) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is PurityKey => (PURITY_KEYS as string[]).includes(s));
  return {
    q: str('q', 80),
    category: str('category'),
    collection: str('collection'),
    purity: purity.length ? purity : undefined,
    min: num('min'),
    max: num('max'),
    inStock: query.inStock === '1' || query.inStock === 'true',
    tag: str('tag', 40)?.toLowerCase(),
    sort: sort && (PRODUCT_SORTS as readonly string[]).includes(sort) ? sort : undefined,
    page: Math.min(500, Math.max(1, num('page') ?? 1)),
    limit: Math.min(PAGE_SIZE_MAX, Math.max(1, num('limit') ?? PAGE_SIZE_DEFAULT)),
  };
}

/** Builds the base filter (everything except purity and price, which the facets describe). */
async function baseFilter(p: ListParams): Promise<{ filter: FilterQuery<IProduct>; empty: boolean; textSearch: boolean }> {
  const filter: FilterQuery<IProduct> = { isActive: true };
  if (p.category) {
    const cat = await Category.findOne({ slug: p.category, isActive: true }).select('_id').lean();
    if (!cat) return { filter, empty: true, textSearch: false };
    filter.categoryPath = cat._id;
  }
  if (p.collection) {
    const col = await Collection.findOne({ slug: p.collection, isActive: true }).select('_id').lean();
    if (!col) return { filter, empty: true, textSearch: false };
    filter.collections = col._id;
  }
  if (p.tag) filter.tags = p.tag;
  if (p.inStock) filter.inStock = true;

  let textSearch = false;
  if (p.q && p.q.length >= 2) {
    // Full-text search handles whole words and stemming; fall back to prefix matching for
    // partial words like "jhum" that a text index won't match.
    const textCount = await Product.countDocuments({ ...filter, $text: { $search: p.q } });
    if (textCount > 0) {
      filter.$text = { $search: p.q };
      textSearch = true;
    } else {
      const rx = new RegExp(`(^|\\s|-)${escapeRegex(p.q)}`, 'i');
      filter.$or = [{ name: rx }, { tags: rx }];
    }
  }
  return { filter, empty: false, textSearch };
}

export async function listProducts(p: ListParams, ctx: PricingContext): Promise<ProductListResponse> {
  const emptyResult: ProductListResponse = {
    items: [],
    page: p.page,
    limit: p.limit,
    total: 0,
    pages: 1,
    facets: { purities: [], priceMin: 0, priceMax: 0, collections: [] },
  };
  const { filter: base, empty, textSearch } = await baseFilter(p);
  if (empty) return emptyResult;

  const filter: FilterQuery<IProduct> = { ...base };
  if (p.purity?.length) filter.purity = { $in: p.purity };
  if (p.min !== undefined || p.max !== undefined) {
    filter.minPrice = { $gt: 0 };
    if (p.min !== undefined) filter.minPrice.$gte = p.min * 100;
    if (p.max !== undefined) filter.minPrice.$lte = p.max * 100;
  }

  const sortKey = p.sort ?? (textSearch ? undefined : 'featured');
  // Sold-out pieces always sink to the end so shoppers see what they can buy first.
  const sort: Record<string, SortOrder | { $meta: 'textScore' }> = { inStock: -1 };
  if (sortKey) Object.assign(sort, SORTS[sortKey]);
  else sort.score = { $meta: 'textScore' };
  sort._id = 1;

  const projection = textSearch && !sortKey ? { score: { $meta: 'textScore' } } : {};
  const [docs, total, facets, catMap, rules] = await Promise.all([
    Product.find(filter, projection)
      .sort(sort as Record<string, SortOrder>)
      .skip((p.page - 1) * p.limit)
      .limit(p.limit)
      .select('-description')
      .lean<LeanProduct[]>(),
    Product.countDocuments(filter),
    facetsFor(base),
    categoryRefMap(),
    badgeRules(),
  ]);

  return {
    items: docs.map((d) => toProductCard(d, ctx, catMap, rules)),
    page: p.page,
    limit: p.limit,
    total,
    pages: Math.max(1, Math.ceil(total / p.limit)),
    facets,
  };
}

async function facetsFor(base: FilterQuery<IProduct>): Promise<ProductListResponse['facets']> {
  const key = `public:facets:${JSON.stringify(base, (_k, v) => (v instanceof RegExp ? v.source : v))}`;
  return cached(key, 60_000, async () => {
    // Collection counts ignore any collection filter, so shoppers can switch between collections.
    const { collections: _collection, ...withoutCollection } = base;
    const [[res], byCollection, activeCollections] = await Promise.all([
      Product.aggregate<{
        purities: { _id: PurityKey; count: number }[];
        price: { min: number; max: number }[];
      }>([
        { $match: base },
        {
          $facet: {
            purities: [{ $match: { purity: { $ne: null } } }, { $group: { _id: '$purity', count: { $sum: 1 } } }],
            price: [{ $match: { minPrice: { $gt: 0 } } }, { $group: { _id: null, min: { $min: '$minPrice' }, max: { $max: '$minPrice' } } }],
          },
        },
      ]),
      Product.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: withoutCollection },
        { $unwind: '$collections' },
        { $group: { _id: '$collections', count: { $sum: 1 } } },
      ]),
      Collection.find({ isActive: true }).sort({ isFeatured: -1, sortOrder: 1 }).select('name slug').lean(),
    ]);
    const counts = new Map(byCollection.map((c) => [String(c._id), c.count]));
    const order = new Map(PURITY_KEYS.map((k, i) => [k, i]));
    return {
      purities: (res?.purities ?? [])
        .filter((x) => x._id)
        .sort((a, b) => (order.get(a._id) ?? 0) - (order.get(b._id) ?? 0))
        .map((x) => ({ key: x._id, count: x.count })),
      priceMin: res?.price?.[0]?.min ?? 0,
      priceMax: res?.price?.[0]?.max ?? 0,
      collections: activeCollections
        .map((c) => ({ slug: c.slug, name: c.name, count: counts.get(String(c._id)) ?? 0 }))
        .filter((c) => c.count > 0),
    };
  });
}

export async function relatedProducts(product: LeanProduct, ctx: PricingContext, limit = 8) {
  const exclude: Types.ObjectId[] = [product._id];
  const found: LeanProduct[] = [];
  const pick = async (filter: FilterQuery<IProduct>) => {
    if (found.length >= limit) return;
    const docs = await Product.find({ isActive: true, _id: { $nin: exclude }, ...filter })
      .sort({ inStock: -1, soldCount: -1, createdAt: -1 })
      .limit(limit - found.length)
      .select('-description')
      .lean<LeanProduct[]>();
    for (const d of docs) {
      found.push(d);
      exclude.push(d._id);
    }
  };
  await pick({ category: product.category });
  if (product.collections?.length) await pick({ collections: { $in: product.collections } });
  const parent = product.categoryPath?.length > 1 ? product.categoryPath[product.categoryPath.length - 2] : undefined;
  if (parent) await pick({ categoryPath: parent });
  const catMap = await categoryRefMap();
  return found.map((d) => toProductCard(d, ctx, catMap));
}
