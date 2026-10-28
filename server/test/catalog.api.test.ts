import { beforeAll, describe, expect, it } from 'vitest';
import type { ProductDetailDTO, ProductListResponse, SearchSuggestions } from '@goldshop/shared';
import { invalidatePublicCache } from '../src/lib/cache';
import { Collection, Product } from '../src/models';
import { api, createCategory, createProduct, seedSettings } from './helpers';

beforeAll(async () => {
  await seedSettings();
  const earrings = await createCategory('Earrings');
  const jhumkas = await createCategory('Jhumkas', earrings._id);
  const rings = await createCategory('Rings');
  await createProduct({ name: 'Lotus Jhumka', category: jhumkas._id, purity: 'gold22', tags: ['temple', 'festive'], variants: [{ sku: 'LJ-1', netWeightMg: 6000, stock: 2 }], soldCount: 5 });
  await createProduct({ name: 'Peacock Jhumka', category: jhumkas._id, purity: 'gold22', variants: [{ sku: 'PJ-1', netWeightMg: 9000, stock: 0 }] });
  await createProduct({ name: 'Petal Stud', category: earrings._id, purity: 'gold18', isFeatured: true, variants: [{ sku: 'PS-1', netWeightMg: 1500, stock: 4 }] });
  await createProduct({
    name: 'Classic Band Ring',
    category: rings._id,
    purity: 'gold22',
    variants: [
      { sku: 'CB-12', label: '12', netWeightMg: 2500, stock: 1 },
      { sku: 'CB-14', label: '14', netWeightMg: 2900, stock: 3 },
    ],
  });
  await createProduct({ name: 'Hidden Draft Ring', category: rings._id, purity: 'gold22', isActive: false, variants: [{ sku: 'HD-1', netWeightMg: 2000, stock: 5 }] });
});

describe('product listing', () => {
  it('lists only active products, with sold-out pieces last', async () => {
    const res = await api().get('/api/products').expect(200);
    const body = res.body as ProductListResponse;
    expect(body.total).toBe(4);
    expect(body.items.map((p) => p.name)).not.toContain('Hidden Draft Ring');
    expect(body.items.at(-1)?.name).toBe('Peacock Jhumka');
    expect(body.items.at(-1)?.inStock).toBe(false);
  });

  it('includes sub-category products when filtering by a parent category', async () => {
    const res = await api().get('/api/products?category=earrings').expect(200);
    expect((res.body as ProductListResponse).items.map((p) => p.name).sort()).toEqual(['Lotus Jhumka', 'Peacock Jhumka', 'Petal Stud']);
  });

  it('filters by purity, availability and price range (rupees)', async () => {
    const byPurity = (await api().get('/api/products?purity=gold18').expect(200)).body as ProductListResponse;
    expect(byPurity.items.map((p) => p.name)).toEqual(['Petal Stud']);

    const inStock = (await api().get('/api/products?category=jhumkas&inStock=1').expect(200)).body as ProductListResponse;
    expect(inStock.items.map((p) => p.name)).toEqual(['Lotus Jhumka']);

    const cheap = (await api().get('/api/products?max=30000').expect(200)).body as ProductListResponse;
    expect(cheap.items.every((p) => p.price <= 3_000_000)).toBe(true);
    expect(cheap.items.length).toBeGreaterThan(0);
  });

  it('sorts by price and reports facets', async () => {
    const res = (await api().get('/api/products?sort=price_asc&inStock=1').expect(200)).body as ProductListResponse;
    const prices = res.items.map((p) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(res.facets.purities.map((f) => f.key)).toEqual(expect.arrayContaining(['gold22', 'gold18']));
    expect(res.facets.priceMax).toBeGreaterThan(res.facets.priceMin);
  });

  it('paginates with a bounded page size', async () => {
    const res = (await api().get('/api/products?limit=2&page=2').expect(200)).body as ProductListResponse;
    expect(res.items).toHaveLength(2);
    expect(res.pages).toBe(2);
    const capped = (await api().get('/api/products?limit=5000').expect(200)).body as ProductListResponse;
    expect(capped.limit).toBe(48);
  });

  it('marks multi-price products as "from" and offers quick add only for single-variant pieces', async () => {
    const res = (await api().get('/api/products?q=band').expect(200)).body as ProductListResponse;
    expect(res.items[0].priceFrom).toBe(true);
    expect(res.items[0].quickAddVariantId).toBeUndefined();
    const stud = (await api().get('/api/products?q=petal').expect(200)).body as ProductListResponse;
    expect(stud.items[0].quickAddVariantId).toBeDefined();
  });
});

describe('search', () => {
  it('matches whole words and tags', async () => {
    const res = (await api().get('/api/products?q=temple').expect(200)).body as ProductListResponse;
    expect(res.items.map((p) => p.name)).toEqual(['Lotus Jhumka']);
  });

  it('falls back to prefix matching for partial words', async () => {
    const res = (await api().get('/api/products?q=jhum').expect(200)).body as ProductListResponse;
    expect(res.items.map((p) => p.name).sort()).toEqual(['Lotus Jhumka', 'Peacock Jhumka']);
  });

  it('treats regex characters literally', async () => {
    await api().get('/api/products?q=.*(').expect(200);
    await api().get('/api/search/suggest?q=.*(').expect(200);
  });

  it('suggests products and categories', async () => {
    const res = (await api().get('/api/search/suggest?q=jh').expect(200)).body as SearchSuggestions;
    expect(res.products.map((p) => p.name)).toContain('Lotus Jhumka');
    expect(res.categories.map((c) => c.slug)).toContain('jhumkas');
  });
});

describe('product detail', () => {
  it('returns variants with server-computed price breakdowns', async () => {
    const res = (await api().get('/api/products/classic-band-ring').expect(200)).body as ProductDetailDTO;
    expect(res.variants).toHaveLength(2);
    const v = res.variants[0];
    expect(v.price.total).toBe(v.price.taxable + v.price.gst);
    expect(v.price.ratePerGram).toBe(1_173_000);
    expect(res.categoryPath.map((c) => c.slug)).toEqual(['rings']);
    expect(v.lowStock).toBe(1);
  });

  it('404s for missing or hidden products', async () => {
    await api().get('/api/products/nope').expect(404);
    await api().get('/api/products/hidden-draft-ring').expect(404);
  });

  it('returns related products from the same category first', async () => {
    const res = await api().get('/api/products/lotus-jhumka/related').expect(200);
    expect(res.body[0].name).toBe('Peacock Jhumka');
  });
});

describe('home', () => {
  it('only shows bestsellers backed by real sales', async () => {
    const res = await api().get('/api/home').expect(200);
    expect(res.body.bestsellers.map((p: { name: string }) => p.name)).toEqual(['Lotus Jhumka']);
    expect(res.body.featured.map((p: { name: string }) => p.name)).toEqual(['Petal Stud']);
  });
});

describe('listing badges and collection counts', () => {
  it('earns badges from real data only', async () => {
    invalidatePublicCache();
    const { items } = (await api().get('/api/products').expect(200)).body as ProductListResponse;
    const byName = new Map(items.map((p) => [p.name, p]));
    // 5 real sales clears the bestseller bar; every piece here was just added, so all are new.
    expect(byName.get('Lotus Jhumka')?.badges).toEqual(['bestseller', 'new']);
    expect(byName.get('Petal Stud')?.badges).toEqual(['new']);
  });

  it('counts pieces per collection, ignoring the collection filter itself', async () => {
    const festive = await Collection.create({ name: 'Festive Edit', slug: 'festive-edit', isActive: true });
    await Product.updateOne({ name: 'Lotus Jhumka' }, { $set: { collections: [festive._id] } });
    invalidatePublicCache();
    const all = (await api().get('/api/products?category=earrings').expect(200)).body as ProductListResponse;
    expect(all.facets.collections).toEqual([{ slug: 'festive-edit', name: 'Festive Edit', count: 1 }]);
    const filtered = (await api().get('/api/products?category=earrings&collection=festive-edit').expect(200)).body as ProductListResponse;
    expect(filtered.items.map((p) => p.name)).toEqual(['Lotus Jhumka']);
    expect(filtered.facets.collections).toEqual(all.facets.collections);
  });
});

describe('collections', () => {
  it('serves the small heading and the wide photo, and leaves out what is not set', async () => {
    await Collection.create({
      name: 'Temple Edit',
      slug: 'temple-edit',
      eyebrow: 'Tradition',
      tagline: 'Divine designs',
      image: { key: 'collections/cover', alt: 'Cover' },
      banner: { key: 'collections/wide', alt: 'Wide' },
      isActive: true,
    });
    invalidatePublicCache();
    const list = (await api().get('/api/collections').expect(200)).body as { slug: string; eyebrow?: string; banner?: { key: string } }[];
    const temple = list.find((c) => c.slug === 'temple-edit');
    expect(temple).toMatchObject({ eyebrow: 'Tradition', banner: { key: 'collections/wide' } });
    const festive = list.find((c) => c.slug === 'festive-edit');
    expect(festive?.eyebrow).toBeUndefined();
    expect(festive?.banner).toBeUndefined();
    const detail = (await api().get('/api/collections/temple-edit').expect(200)).body;
    expect(detail).toMatchObject({ eyebrow: 'Tradition', banner: { key: 'collections/wide' }, image: { key: 'collections/cover' } });
  });
});

describe('logo for the opening screen', () => {
  it('redirects to the uploaded logo, and serves the lotus before one is uploaded', async () => {
    await seedSettings({ brand: { logo: null, mark: null } });
    const none = await api().get('/api/brand/logo').expect(200);
    expect(none.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(String(none.body ?? none.text)).toContain('<svg');

    await seedSettings({ brand: { logo: { key: 'brand/202610/logo', alt: 'Logo', width: 1729, height: 683 }, mark: null } });
    const res = await api().get('/api/brand/logo').expect(302);
    expect(res.headers.location).toBe('/uploads/brand/202610/logo-960.webp');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });
});
