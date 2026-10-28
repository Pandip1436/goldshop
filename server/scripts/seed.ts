/**
 * Seeds the database. Safe to run repeatedly: it only inserts what is missing and never
 * overwrites settings or content you have edited.
 *
 *   npm run seed               default settings, policy templates, FAQs, journal guides
 *   npm run seed:demo          the above + a demonstration catalogue (flagged demo: true)
 *   npm run seed:clear-demo    removes every demo product, collection, category, banner and post
 *
 * Optionally set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin account.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { Types } from 'mongoose';
import type { ImageRef } from '@goldshop/shared';
import { env } from '../src/config/env';
import { connectDb, disconnectDb } from '../src/db';
import { Banner, Category, Collection, Faq, Page, Post, Product, Settings, User } from '../src/models';
import { applyDerivedFields, categoryLineage } from '../src/services/catalog';
import { getSettings, invalidateSettings, ratesFrom } from '../src/services/settings';
import { deleteImageFiles, processImage } from '../src/services/uploads';
import { DEFAULT_BENEFITS, DEFAULT_FAQS, DEFAULT_PAGES, DEFAULT_POSTS } from './seed-content';
import { DEMO_BANNERS, DEMO_CATEGORIES, DEMO_COLLECTIONS, DEMO_PRODUCTS, DEMO_RATES_RUPEES } from './seed-demo';

const args = new Set(process.argv.slice(2));
const DEMO = args.has('--demo');
const CLEAR_DEMO = args.has('--clear-demo');
const ASSETS = path.join(env.serverRoot, 'seed-assets', 'demo');

const log = (...m: unknown[]) => console.log('  ·', ...m);

/* --------------------------------------------------------------- images */

const imageCache = new Map<string, ImageRef>();

/** The original photo with its outer few percent faded to transparent, so it blends into the extended backdrop. */
async function featherEdges(buf: Buffer, w: number, h: number): Promise<Buffer> {
  const f = Math.max(8, Math.round(Math.min(w, h) * 0.06));
  const mask = Buffer.from(
    `<svg width="${w}" height="${h}"><defs><filter id="b"><feGaussianBlur stdDeviation="${f / 2}"/></filter></defs>` +
      `<rect x="${f}" y="${f}" width="${w - 2 * f}" height="${h - 2 * f}" fill="#fff" filter="url(#b)"/></svg>`,
  );
  const alpha = await sharp(mask).extractChannel(0).toBuffer();
  return sharp(buf).removeAlpha().joinChannel(alpha).png().toBuffer();
}

/** Produces a 4:5 portrait product shot, either by padding with the background or centre-cropping. */
async function portrait(file: string, fit: 'pad' | 'crop', detail = false): Promise<Buffer> {
  let buf: Buffer = await fs.readFile(path.join(ASSETS, `${file}.jpg`));
  const meta = await sharp(buf).metadata();
  let w = meta.width ?? 0;
  let h = meta.height ?? 0;
  if (detail) {
    // A closer "detail" view for the second gallery image.
    const cw = Math.round(w * 0.62);
    const ch = Math.round(h * 0.62);
    buf = await sharp(buf).extract({ left: Math.round((w - cw) / 2), top: Math.round((h - ch) / 2.2), width: cw, height: ch }).toBuffer();
    w = cw;
    h = ch;
  }
  const targetRatio = 4 / 5;
  if (fit === 'crop') {
    return sharp(buf).resize({ width: Math.min(w, Math.round(h * targetRatio)), height: Math.min(h, Math.round(w / targetRatio)), fit: 'cover', position: 'centre' }).toBuffer();
  }
  let tw = w;
  let th = h;
  if (w / h > targetRatio) th = Math.round(w / targetRatio);
  else tw = Math.round(h * targetRatio);
  const padX = tw - w;
  const padY = th - h;
  // Replicating the edge pixels continues studio backdrops (including gradients) without a visible seam;
  // the faint blur softens any streaks from texture at the very edge.
  const extended = await sharp(buf)
    .extend({ left: Math.floor(padX / 2), right: Math.ceil(padX / 2), top: Math.floor(padY / 2), bottom: Math.ceil(padY / 2), extendWith: 'copy' })
    .toBuffer();
  const softened = await sharp(extended).blur(18).toBuffer();
  return sharp(softened)
    .composite([{ input: await featherEdges(buf, w, h), left: Math.floor(padX / 2), top: Math.floor(padY / 2) }])
    .toBuffer();
}

async function productImage(file: string, fit: 'pad' | 'crop', alt: string, detail = false): Promise<ImageRef> {
  const key = `${file}:${fit}:${detail}`;
  const hit = imageCache.get(key);
  if (hit) return { ...hit, alt };
  const img = await processImage(await portrait(file, fit, detail), 'demo', alt);
  imageCache.set(key, img);
  return img;
}

async function rawImage(file: string, alt: string): Promise<ImageRef> {
  const key = `${file}:raw`;
  const hit = imageCache.get(key);
  if (hit) return { ...hit, alt };
  const img = await processImage(await fs.readFile(path.join(ASSETS, `${file}.jpg`)), 'demo', alt);
  imageCache.set(key, img);
  return img;
}

/* ------------------------------------------------------------- defaults */

async function seedSettings() {
  const existing = await Settings.findOne({ key: 'store' }).lean();
  if (existing) {
    log('Settings already exist — left unchanged');
    return;
  }
  await Settings.create({
    key: 'store',
    store: {
      name: 'Iniya Jewellers',
      tagline: 'Fine gold jewellery, priced in the open',
      description: 'Gold jewellery with transparent, rate-linked pricing: every piece shows its gold value, making charge and GST.',
    },
    displayRates: ['gold24', 'gold22', 'gold18'],
    tax: { gstRateBps: 300, hsnCode: '7113' },
    checkout: { guestCheckout: true, orderPrefix: 'IJ', codEnabled: false, codMaxOrderValue: 0, codFee: 0, returnWindowDays: 0 },
    shipping: { zones: [], fallbackEnabled: true, fallbackRate: 0, fallbackFreeAbove: 0, fallbackCod: false, fallbackEtaMin: 4, fallbackEtaMax: 8, note: '' },
    benefits: DEFAULT_BENEFITS,
    stats: [],
    savingsPlan: {
      enabled: true,
      summary: 'Set aside a fixed amount each month and put your savings towards any piece in our store. Leave your details and we will call you to explain how the plan works.',
    },
    // Left blank so page titles follow the store name, even after it is renamed.
    seo: { titleSuffix: '', defaultDescription: '' },
  });
  log('Created store settings for Iniya Jewellers (change the name in Admin → Website settings)');
}

async function seedPages() {
  for (const p of DEFAULT_PAGES) {
    const r = await Page.updateOne({ slug: p.slug }, { $setOnInsert: { ...p, isPublished: true } }, { upsert: true });
    if (r.upsertedCount) log(`Page: ${p.title}`);
  }
}

async function seedFaqs() {
  if (await Faq.estimatedDocumentCount()) return log('FAQs already exist — left unchanged');
  await Faq.insertMany(DEFAULT_FAQS.map((f, i) => ({ ...f, sortOrder: i, isPublished: true })));
  log(`${DEFAULT_FAQS.length} FAQs`);
}

async function seedPosts(withCovers: boolean) {
  const now = Date.now();
  for (const [i, p] of DEFAULT_POSTS.entries()) {
    const exists = await Post.findOne({ slug: p.slug }).select('_id cover').lean();
    if (exists) {
      if (withCovers && !exists.cover?.key) {
        await Post.updateOne({ _id: exists._id }, { $set: { cover: await rawImage(p.cover, p.title) } });
        log(`Post cover: ${p.title}`);
      }
      continue;
    }
    const { cover, ...rest } = p;
    await Post.create({
      ...rest,
      isPublished: true,
      publishedAt: new Date(now - i * 86400_000 * 3),
      cover: withCovers ? await rawImage(cover, p.title) : undefined,
    });
    log(`Post: ${p.title}`);
  }
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
      log(`Promoted ${email} to admin`);
    }
    return;
  }
  await User.create({ name: 'Store admin', email, role: 'admin', passwordHash: await bcrypt.hash(password, 12) });
  log(`Admin account ${email}`);
}

/* ----------------------------------------------------------------- demo */

async function seedDemo() {
  const settings = await getSettings({ fresh: true });

  // Demo rates only if none are set, so real rates are never overwritten.
  if (!Object.keys(ratesFrom(settings)).length) {
    const set: Record<string, unknown> = { 'goldRates.updatedAt': new Date(), 'goldRates.updatedBy': 'Demo seed' };
    for (const [k, v] of Object.entries(DEMO_RATES_RUPEES)) set[`goldRates.${k}`] = v * 100;
    await Settings.updateOne({ key: 'store' }, { $set: set });
    log('Demo gold rates (illustrative — update them in Admin → Gold rates)');
  }
  // Demo-friendly checkout settings, only on a store that has not configured these yet.
  if (!settings.shipping?.zones?.length) {
    await Settings.updateOne(
      { key: 'store' },
      {
        $set: {
          'checkout.codEnabled': true,
          'checkout.codMaxOrderValue': 200_000_00,
          'checkout.returnWindowDays': 7,
          'shipping.zones': [
            { name: 'Tamil Nadu & Puducherry', states: ['Tamil Nadu', 'Puducherry'], pinPrefixes: ['60', '61', '62', '63', '64'], rate: 0, freeAbove: 0, codAvailable: true, etaMinDays: 2, etaMaxDays: 4, isActive: true },
          ],
          'shipping.fallbackEnabled': true,
          'shipping.fallbackRate': 250_00,
          'shipping.fallbackFreeAbove': 25_000_00,
          'shipping.fallbackCod': false,
          'shipping.fallbackEtaMin': 4,
          'shipping.fallbackEtaMax': 8,
          'announcement.enabled': true,
          'announcement.text': 'Prices follow today’s gold rate — full breakdown on every piece',
          'announcement.href': '/gold-rate',
        },
      },
    );
    log('Demo shipping zones and cash on delivery');
  }
  invalidateSettings();
  const fresh = await getSettings({ fresh: true });
  const ctx = { rates: ratesFrom(fresh), gstRateBps: fresh.tax?.gstRateBps ?? 300 };

  const catIds = new Map<string, Types.ObjectId>();
  for (const c of DEMO_CATEGORIES) {
    let doc = await Category.findOne({ slug: c.slug });
    if (!doc) {
      doc = await Category.create({
        name: c.name,
        slug: c.slug,
        parent: c.parent ? catIds.get(c.parent) : null,
        description: c.description,
        image: c.image ? await productImage(c.image, 'pad', c.name) : undefined,
        sortOrder: c.sort,
        demo: true,
      });
      log(`Category: ${c.name}`);
    }
    catIds.set(c.slug, doc._id);
  }

  const colIds = new Map<string, Types.ObjectId>();
  for (const c of DEMO_COLLECTIONS) {
    let doc = await Collection.findOne({ slug: c.slug });
    if (!doc) {
      doc = await Collection.create({
        name: c.name,
        slug: c.slug,
        tagline: c.tagline,
        description: c.description,
        image: await rawImage(c.image, c.name),
        isFeatured: c.featured,
        sortOrder: c.sort,
        demo: true,
      });
      log(`Collection: ${c.name}`);
    }
    colIds.set(c.slug, doc._id);
  }

  let created = 0;
  for (const [i, p] of DEMO_PRODUCTS.entries()) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (await Product.exists({ slug })) continue;
    const category = catIds.get(p.category)!;
    const images: ImageRef[] = [];
    for (const [j, im] of p.images.entries()) images.push(await productImage(im.file, im.fit, j === 0 ? p.name : `${p.name} — detail`, im.detail));
    const doc = {
      name: p.name,
      slug,
      shortDescription: p.short,
      description: p.description,
      category,
      categoryPath: await categoryLineage(category),
      collections: p.collections.map((c) => colIds.get(c)!).filter(Boolean),
      tags: p.tags,
      purity: p.purity,
      pricingMode: 'weight' as const,
      making: { type: p.making.type, value: p.making.type === 'percent' ? p.making.value : p.making.value * 100 },
      makingDiscountPercent: p.makingDiscountPercent ?? 0,
      optionNames: p.optionNames ?? [],
      specs: [
        ['Metal', `${p.purity === 'gold24' ? '24K' : p.purity === 'gold22' ? '22K' : '18K'} gold`],
        ['Hallmark', 'Demo product — no hallmark'],
        ...p.specs,
      ].map(([label, value]) => ({ label, value })),
      images,
      isActive: true,
      isFeatured: Boolean(p.featured),
      sortOrder: i,
      demo: true,
      variants: p.variants.map((v) => ({
        _id: new Types.ObjectId(),
        sku: v.sku,
        label: v.label ?? 'Standard',
        attributes: v.attributes ?? {},
        netWeightMg: Math.round(v.weight * 1000),
        grossWeightMg: Math.round(v.weight * 1000 * (v.stone ? 1.04 : 1)),
        stoneCharge: (v.stone ?? 0) * 100,
        fixedPrice: 0,
        compareAtPrice: 0,
        stock: v.stock,
        isActive: true,
        priceCache: 0,
      })),
      minPrice: 0,
      maxPrice: 0,
      inStock: false,
      totalStock: 0,
    };
    applyDerivedFields(doc, ctx);
    await Product.create(doc);
    created++;
  }
  log(`${created} demo products`);

  if (!(await Banner.exists({}))) {
    for (const [i, b] of DEMO_BANNERS.entries()) {
      await Banner.create({ ...b, image: await rawImage(b.image, b.title), sortOrder: i, isActive: true, demo: true });
    }
    log('Demo hero banner');
  }

  await seedPosts(true);
  await Post.updateMany({ slug: { $in: DEFAULT_POSTS.map((p) => p.slug) } }, { $set: { demo: false } });
}

async function clearDemo() {
  const collect = (docs: { images?: ImageRef[]; image?: ImageRef | null; cover?: ImageRef | null }[]) =>
    docs.flatMap((d) => [...(d.images ?? []), d.image, d.cover]).filter((i): i is ImageRef => Boolean(i?.key));
  const [products, collections, categories, banners] = await Promise.all([
    Product.find({ demo: true }).select('images').lean(),
    Collection.find({ demo: true }).select('image').lean(),
    Category.find({ demo: true }).select('image').lean(),
    Banner.find({ demo: true }).select('image').lean(),
  ]);
  const keys = new Set(collect([...products, ...collections, ...categories, ...banners] as never[]).map((i) => i.key));

  const p = await Product.deleteMany({ demo: true });
  await Collection.deleteMany({ demo: true });
  // Keep a demo category if your own products already use it.
  let removedCats = 0;
  for (const c of await Category.find({ demo: true }).sort({ parent: -1 }).lean()) {
    if ((await Product.exists({ categoryPath: c._id })) || (await Category.exists({ parent: c._id }))) {
      await Category.updateOne({ _id: c._id }, { $set: { demo: false }, $unset: { image: 1 } });
      continue;
    }
    await Category.deleteOne({ _id: c._id });
    removedCats++;
  }
  await Banner.deleteMany({ demo: true });
  // Journal guides are real content; only their demo cover photos are removed.
  const posts = await Post.find({ 'cover.key': { $regex: '^demo/' } }).select('cover').lean();
  for (const post of posts) if (post.cover?.key) keys.add(post.cover.key);
  await Post.updateMany({ 'cover.key': { $regex: '^demo/' } }, { $unset: { cover: 1 } });
  for (const k of keys) if (k.startsWith('demo/')) await deleteImageFiles(k);
  log(`Removed ${p.deletedCount} demo products, ${removedCats} demo categories, demo collections and banners`);
}

async function main() {
  console.log(`Seeding ${env.mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);
  await connectDb();
  if (CLEAR_DEMO) {
    await clearDemo();
  } else {
    await seedSettings();
    await seedPages();
    await seedFaqs();
    if (DEMO) await seedDemo();
    else await seedPosts(false);
    await seedAdmin();
  }
  await disconnectDb();
  console.log('Done.');
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
