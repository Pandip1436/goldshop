import { Router } from 'express';
import multer from 'multer';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { escapeRegex, objectId, paginated, pagination, parse } from '../../lib/http';
import { uniqueSlug } from '../../lib/slug';
import { requirePermission } from '../../middleware/auth';
import { Category, Collection, InventoryLog, Order, Product, type IProduct, type ProductDoc } from '../../models';
import { applyDerivedFields, categoryLineage } from '../../services/catalog';
import { setVariantStock } from '../../services/inventory';
import { priceVariant } from '../../services/pricing';
import { getSettings, ratesFrom } from '../../services/settings';
import { deleteImageFiles, processImage } from '../../services/uploads';
import { categoryInput, collectionInput, productInput, type ProductInput } from './schemas';

export const adminCatalogRouter = Router();

async function pricingCtx() {
  const s = await getSettings({ fresh: true });
  return { rates: ratesFrom(s), gstRateBps: s.tax?.gstRateBps ?? 300 };
}

/* ---------------------------------------------------------------- uploads */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

adminCatalogRouter.post('/uploads', requirePermission('catalog:write'), upload.array('files', 10), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('Choose at least one image.');
  const folder = typeof req.query.folder === 'string' ? req.query.folder : 'products';
  const images = [];
  for (const f of files) images.push(await processImage(f.buffer, folder, f.originalname.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')));
  res.status(201).json(images);
});

/* --------------------------------------------------------------- products */

adminCatalogRouter.get('/products', requirePermission('catalog:write'), async (req, res) => {
  const { page, limit, skip } = pagination(req, 100, 25);
  const filter: FilterQuery<IProduct> = {};
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { 'variants.sku': rx }, { tags: rx }];
  }
  if (typeof req.query.category === 'string' && /^[a-f0-9]{24}$/i.test(req.query.category)) {
    filter.categoryPath = new Types.ObjectId(req.query.category);
  }
  switch (req.query.status) {
    case 'active': filter.isActive = true; break;
    case 'hidden': filter.isActive = false; break;
    case 'out': filter.totalStock = { $lte: 0 }; break;
    case 'low': filter.totalStock = { $gt: 0, $lte: 2 }; break;
    case 'featured': filter.isFeatured = true; break;
    case 'demo': filter.demo = true; break;
  }
  const [items, total, cats] = await Promise.all([
    Product.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit)
      .select('name slug images category purity pricingMode minPrice maxPrice totalStock isActive isFeatured variants.sku variants.isActive soldCount updatedAt demo')
      .lean(),
    Product.countDocuments(filter),
    Category.find().select('name').lean(),
  ]);
  const catNames = new Map(cats.map((c) => [String(c._id), c.name]));
  res.json(
    paginated(
      items.map((p) => ({
        id: String(p._id),
        name: p.name,
        slug: p.slug,
        image: p.images?.[0],
        category: catNames.get(String(p.category)) ?? '',
        purity: p.purity,
        pricingMode: p.pricingMode,
        minPrice: p.minPrice,
        maxPrice: p.maxPrice,
        totalStock: p.totalStock,
        isActive: p.isActive,
        isFeatured: p.isFeatured,
        variantCount: p.variants.length,
        sku: p.variants[0]?.sku ?? '',
        soldCount: p.soldCount,
        demo: p.demo,
        updatedAt: p.updatedAt,
      })),
      total,
      page,
      limit,
    ),
  );
});

adminCatalogRouter.get('/products/:id', requirePermission('catalog:write'), async (req, res) => {
  const p = await Product.findById(objectId(String(req.params.id), 'Product')).lean();
  if (!p) throw notFound('Product not found.');
  res.json({
    ...p,
    id: String(p._id),
    variants: p.variants.map((v) => ({ ...v, id: String(v._id) })),
  });
});

/** Live price preview for the product editor, using today's rates. */
adminCatalogRouter.post('/products/preview-price', requirePermission('catalog:write'), async (req, res) => {
  const schema = z.object({
    pricingMode: z.enum(['weight', 'fixed']),
    purity: z.string().optional().nullable(),
    making: z.object({ type: z.enum(['percent', 'per_gram', 'flat']), value: z.number().min(0) }),
    makingDiscountPercent: z.number().min(0).max(100).default(0),
    variants: z.array(z.object({ netWeightMg: z.number().default(0), stoneCharge: z.number().default(0), fixedPrice: z.number().default(0) })).max(50),
  });
  const input = parse(schema, req.body);
  const ctx = await pricingCtx();
  res.json(
    input.variants.map((v) =>
      priceVariant({ ...input, purity: input.purity as IProduct['purity'] }, v, ctx.rates, ctx.gstRateBps),
    ),
  );
});

async function buildProductDoc(input: ProductInput, existing?: ProductDoc) {
  if (!(await Category.exists({ _id: input.category }))) throw badRequest('Choose a valid category.', { category: 'Invalid category' });
  const slugBase = input.slug || input.name;
  const slug =
    existing && (!input.slug || input.slug === existing.slug)
      ? existing.slug
      : await uniqueSlug(slugBase, async (s) => Boolean(await Product.exists({ slug: s, ...(existing ? { _id: { $ne: existing._id } } : {}) })));

  const previous = new Map((existing?.variants ?? []).map((v) => [String(v._id), v]));
  const variants = input.variants.map((v) => {
    const prior = v.id ? previous.get(v.id) : undefined;
    return {
      _id: prior?._id ?? new Types.ObjectId(),
      sku: v.sku,
      label: v.label || 'Standard',
      attributes: v.attributes,
      netWeightMg: v.netWeightMg,
      grossWeightMg: v.grossWeightMg || v.netWeightMg,
      stoneCharge: v.stoneCharge,
      fixedPrice: v.fixedPrice,
      compareAtPrice: v.compareAtPrice,
      // Stock of an existing variant is never overwritten from the editor — see the inventory endpoint.
      stock: prior ? prior.stock : v.stock,
      isActive: v.isActive,
      priceCache: 0,
    };
  });

  const doc = {
    name: input.name,
    slug,
    shortDescription: input.shortDescription,
    description: input.description,
    category: new Types.ObjectId(input.category),
    categoryPath: await categoryLineage(input.category),
    collections: input.collections.map((c) => new Types.ObjectId(c)),
    tags: [...new Set(input.tags.filter(Boolean))],
    purity: input.pricingMode === 'weight' ? input.purity ?? undefined : input.purity ?? undefined,
    pricingMode: input.pricingMode,
    making: input.making,
    makingDiscountPercent: input.makingDiscountPercent,
    variants,
    optionNames: input.optionNames.filter(Boolean),
    specs: input.specs.filter((s) => s.label && s.value),
    images: input.images,
    isActive: input.isActive,
    isFeatured: input.isFeatured,
    sortOrder: input.sortOrder,
    seo: input.seo,
    minPrice: 0,
    maxPrice: 0,
    inStock: false,
    totalStock: 0,
  };
  applyDerivedFields(doc, await pricingCtx());
  const newVariants = variants.filter((v) => !previous.has(String(v._id)) && v.stock > 0);
  return { doc, newVariants };
}

adminCatalogRouter.post('/products', requirePermission('catalog:write'), async (req, res) => {
  const input = parse(productInput, req.body);
  const { doc, newVariants } = await buildProductDoc(input);
  const product = await Product.create(doc);
  if (newVariants.length) {
    await InventoryLog.insertMany(newVariants.map((v) => ({ product: product._id, variant: v._id, sku: v.sku, delta: v.stock, stockAfter: v.stock, reason: 'initial', by: req.user!.id })));
  }
  res.status(201).json({ id: String(product._id), slug: product.slug });
});

adminCatalogRouter.put('/products/:id', requirePermission('catalog:write'), async (req, res) => {
  const id = objectId(String(req.params.id), 'Product');
  const input = parse(productInput, req.body);
  // The editor rewrites the variants array but must never clobber stock that an order changed
  // in the meantime. The write is guarded on the stock values we read; on a mismatch we re-read
  // and rebuild.
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await Product.findById(id);
    if (!existing) throw notFound('Product not found.');
    const { doc, newVariants } = await buildProductDoc(input, existing);
    const guard = existing.variants.map((v) => ({ variants: { $elemMatch: { _id: v._id, stock: v.stock } } }));
    const r = await Product.updateOne(
      { _id: id, ...(guard.length ? { $and: guard } : {}) },
      { $set: doc },
      { runValidators: true },
    );
    if (r.matchedCount === 0) continue;
    if (newVariants.length) {
      await InventoryLog.insertMany(
        newVariants.map((v) => ({ product: id, variant: v._id, sku: v.sku, delta: v.stock, stockAfter: v.stock, reason: 'initial', by: req.user!.id })),
      );
    }
    return void res.json({ id: String(id), slug: doc.slug });
  }
  throw conflict('Stock changed while saving. Please try again.');
});

adminCatalogRouter.patch('/products/:id/flags', requirePermission('catalog:write'), async (req, res) => {
  const input = parse(z.object({ isActive: z.boolean().optional(), isFeatured: z.boolean().optional() }), req.body);
  const r = await Product.updateOne({ _id: objectId(String(req.params.id), 'Product') }, { $set: input });
  if (!r.matchedCount) throw notFound();
  res.json({ ok: true });
});

adminCatalogRouter.delete('/products/:id', requirePermission('catalog:write'), async (req, res) => {
  const id = objectId(String(req.params.id), 'Product');
  const product = await Product.findById(id).lean();
  if (!product) throw notFound();
  // Products that appear in orders are archived, not deleted, so order history stays intact.
  if (await Order.exists({ 'items.product': id })) {
    await Product.updateOne({ _id: id }, { $set: { isActive: false } });
    return void res.json({ archived: true });
  }
  await Product.deleteOne({ _id: id });
  await Promise.all((product.images ?? []).map((img) => (img.key ? deleteImageFiles(img.key) : undefined)));
  res.json({ deleted: true });
});

/* -------------------------------------------------------------- inventory */

adminCatalogRouter.get('/inventory', requirePermission('inventory:write'), async (req, res) => {
  const { page, limit, skip } = pagination(req, 100, 50);
  const threshold = Math.max(0, Math.min(100, Number(req.query.threshold ?? 2)));
  const match: Record<string, unknown> = {};
  if (req.query.filter === 'out') match['variants.stock'] = { $lte: 0 };
  else if (req.query.filter === 'low') match['variants.stock'] = { $gt: 0, $lte: threshold };
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    match.$or = [{ name: rx }, { 'variants.sku': rx }];
  }
  const pipeline = [
    { $unwind: '$variants' },
    { $match: { 'variants.isActive': true, ...match } },
    { $sort: { 'variants.stock': 1 as const, name: 1 as const } },
  ];
  const [rows, countRes] = await Promise.all([
    Product.aggregate([
      ...pipeline,
      { $skip: skip },
      { $limit: limit },
      { $project: { name: 1, slug: 1, isActive: 1, image: { $arrayElemAt: ['$images', 0] }, variant: '$variants' } },
    ]),
    Product.aggregate([...pipeline, { $count: 'n' }]),
  ]);
  res.json(
    paginated(
      rows.map((r) => ({
        productId: String(r._id),
        name: r.name,
        slug: r.slug,
        isActive: r.isActive,
        image: r.image,
        variantId: String(r.variant._id),
        sku: r.variant.sku,
        label: r.variant.label,
        stock: r.variant.stock,
        netWeightMg: r.variant.netWeightMg,
      })),
      countRes[0]?.n ?? 0,
      page,
      limit,
    ),
  );
});

adminCatalogRouter.patch('/inventory/:productId/:variantId', requirePermission('inventory:write'), async (req, res) => {
  const { stock, note } = parse(z.object({ stock: z.number().int().min(0).max(100_000), note: z.string().max(300).default('') }), req.body);
  const result = await setVariantStock(
    objectId(String(req.params.productId), 'Product'),
    objectId(String(req.params.variantId), 'Variant'),
    stock,
    new Types.ObjectId(req.user!.id),
    note,
  );
  res.json(result);
});

adminCatalogRouter.get('/inventory/logs', requirePermission('inventory:write'), async (req, res) => {
  const { page, limit, skip } = pagination(req, 100, 50);
  const filter: Record<string, unknown> = {};
  if (typeof req.query.product === 'string' && /^[a-f0-9]{24}$/i.test(req.query.product)) filter.product = req.query.product;
  const [items, total] = await Promise.all([
    InventoryLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('product', 'name').populate('by', 'name').lean(),
    InventoryLog.countDocuments(filter),
  ]);
  res.json(paginated(items, total, page, limit));
});

/* ------------------------------------------------------------- categories */

adminCatalogRouter.get('/categories', requirePermission('catalog:write'), async (_req, res) => {
  const [cats, counts] = await Promise.all([
    Category.find().sort({ sortOrder: 1, name: 1 }).lean(),
    Product.aggregate<{ _id: Types.ObjectId; n: number }>([{ $unwind: '$categoryPath' }, { $group: { _id: '$categoryPath', n: { $sum: 1 } } }]),
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(cats.map((c) => ({ ...c, id: String(c._id), parent: c.parent ? String(c.parent) : null, productCount: countMap.get(String(c._id)) ?? 0 })));
});

async function assertNoCycle(id: Types.ObjectId | null, parent: string | null | undefined) {
  if (!parent) return;
  if (id && String(id) === parent) throw badRequest('A category cannot be its own parent.', { parent: 'Invalid parent' });
  const all = await Category.find().select('parent').lean();
  const byId = new Map(all.map((c) => [String(c._id), c.parent ? String(c.parent) : null]));
  if (!byId.has(parent)) throw badRequest('Parent category not found.', { parent: 'Invalid parent' });
  let cur: string | null | undefined = parent;
  for (let i = 0; cur && i < 20; i++) {
    if (id && cur === String(id)) throw badRequest('That would create a loop of categories.', { parent: 'Invalid parent' });
    cur = byId.get(cur);
  }
}

/** Recomputes Product.categoryPath for every product under a category whose ancestry changed. */
async function refreshCategoryPaths(categoryId: Types.ObjectId) {
  const products = await Product.find({ categoryPath: categoryId }).select('category').lean();
  for (const p of products) {
    await Product.updateOne({ _id: p._id }, { $set: { categoryPath: await categoryLineage(p.category) } });
  }
}

adminCatalogRouter.post('/categories', requirePermission('catalog:write'), async (req, res) => {
  const input = parse(categoryInput, req.body);
  await assertNoCycle(null, input.parent);
  const slug = await uniqueSlug(input.slug || input.name, async (s) => Boolean(await Category.exists({ slug: s })));
  const cat = await Category.create({ ...input, slug, parent: input.parent || null, image: input.image ?? undefined });
  res.status(201).json({ id: String(cat._id), slug: cat.slug });
});

adminCatalogRouter.put('/categories/:id', requirePermission('catalog:write'), async (req, res) => {
  const id = objectId(String(req.params.id), 'Category');
  const input = parse(categoryInput, req.body);
  const cat = await Category.findById(id);
  if (!cat) throw notFound();
  await assertNoCycle(id, input.parent);
  const parentChanged = String(cat.parent ?? '') !== String(input.parent ?? '');
  const slug = input.slug && input.slug !== cat.slug
    ? await uniqueSlug(input.slug, async (s) => Boolean(await Category.exists({ slug: s, _id: { $ne: id } })))
    : cat.slug;
  cat.set({ ...input, slug, parent: input.parent || null, image: input.image ?? undefined });
  await cat.save();
  if (parentChanged) await refreshCategoryPaths(id);
  res.json({ id: String(cat._id), slug: cat.slug });
});

adminCatalogRouter.delete('/categories/:id', requirePermission('catalog:write'), async (req, res) => {
  const id = objectId(String(req.params.id), 'Category');
  if (await Category.exists({ parent: id })) throw conflict('Move or delete its sub-categories first.');
  if (await Product.exists({ categoryPath: id })) throw conflict('This category still has products. Move them to another category first.');
  await Category.deleteOne({ _id: id });
  res.json({ deleted: true });
});

/* ------------------------------------------------------------ collections */

adminCatalogRouter.get('/collections', requirePermission('catalog:write'), async (_req, res) => {
  const [cols, counts] = await Promise.all([
    Collection.find().sort({ sortOrder: 1, name: 1 }).lean(),
    Product.aggregate<{ _id: Types.ObjectId; n: number }>([{ $unwind: '$collections' }, { $group: { _id: '$collections', n: { $sum: 1 } } }]),
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(cols.map((c) => ({ ...c, id: String(c._id), productCount: countMap.get(String(c._id)) ?? 0 })));
});

adminCatalogRouter.post('/collections', requirePermission('catalog:write'), async (req, res) => {
  const input = parse(collectionInput, req.body);
  const slug = await uniqueSlug(input.slug || input.name, async (s) => Boolean(await Collection.exists({ slug: s })));
  const c = await Collection.create({ ...input, slug, image: input.image ?? undefined, banner: input.banner ?? undefined });
  res.status(201).json({ id: String(c._id), slug: c.slug });
});

adminCatalogRouter.put('/collections/:id', requirePermission('catalog:write'), async (req, res) => {
  const id = objectId(String(req.params.id), 'Collection');
  const input = parse(collectionInput, req.body);
  const c = await Collection.findById(id);
  if (!c) throw notFound();
  const slug = input.slug && input.slug !== c.slug
    ? await uniqueSlug(input.slug, async (s) => Boolean(await Collection.exists({ slug: s, _id: { $ne: id } })))
    : c.slug;
  c.set({ ...input, slug, image: input.image ?? undefined, banner: input.banner ?? undefined });
  await c.save();
  res.json({ id: String(c._id), slug: c.slug });
});

adminCatalogRouter.delete('/collections/:id', requirePermission('catalog:write'), async (req, res) => {
  const id = objectId(String(req.params.id), 'Collection');
  await Product.updateMany({ collections: id }, { $pull: { collections: id } });
  await Collection.deleteOne({ _id: id });
  res.json({ deleted: true });
});
