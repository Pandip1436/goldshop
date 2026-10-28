import fs from 'node:fs/promises';
import path from 'node:path';
import { PURITIES, imageUrl, type ImageRef } from '@goldshop/shared';
import { env } from '../config/env';
import { cached } from '../lib/cache';
import { Category, Collection, Page, Post, Product } from '../models';
import { categoryPath, type LeanProduct } from './catalog';
import { getSettings, ratesFrom } from './settings';
import { toProductCard } from './catalog';

export interface HeadData {
  title: string;
  description: string;
  canonical?: string;
  image?: string;
  type?: 'website' | 'product' | 'article';
  noindex?: boolean;
  jsonLd?: unknown[];
  status: number;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const abs = (p: string) => (p.startsWith('http') ? p : `${env.publicUrl}${p}`);
const imgAbs = (img?: ImageRef) => (img && (img.key || img.url) ? abs(imageUrl(img, 1600)) : undefined);
const clip = (s: string, n = 160) => {
  const t = s.replace(/\s+/g, ' ').replace(/[#*_>`]/g, '').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

const NOINDEX_PREFIXES = ['/cart', '/checkout', '/account', '/login', '/register', '/forgot-password', '/reset-password', '/orders', '/admin', '/wishlist'];

const STATIC_PAGES: Record<string, { title: string; description: string }> = {
  '/shop': { title: 'Shop gold jewellery', description: 'Browse our gold jewellery with live, transparent pricing based on today’s gold rate.' },
  '/collections': { title: 'Collections', description: 'Curated collections of gold jewellery for every day, festival and celebration.' },
  '/about': { title: 'Our story', description: 'The people, craft and promises behind our jewellery.' },
  '/contact': { title: 'Contact us', description: 'Visit the store, call, WhatsApp or send us a message.' },
  '/faq': { title: 'Frequently asked questions', description: 'Answers about gold purity, pricing, delivery, returns and payments.' },
  '/journal': { title: 'Journal', description: 'Guides to gold purity, hallmarking, care and choosing jewellery.' },
  '/gold-savings-plan': { title: 'Gold savings plan', description: 'Save towards your next piece of jewellery with a monthly plan.' },
  '/track-order': { title: 'Track your order', description: 'Check the status of your order.' },
  // Not "today's": the rate may not have been updated today, and this text is cached by search engines.
  '/gold-rate': { title: 'Gold rate', description: 'Our current gold rates per gram, used to price every weight-based piece, with a calculator for the metal value of your gold.' },
};

export async function headFor(urlPath: string): Promise<HeadData> {
  const settings = await getSettings();
  const store = settings.store.name;
  const suffix = settings.seo?.titleSuffix || store;
  const t = (title: string) => (title === store ? title : `${title} | ${suffix}`);
  const defaultDesc = settings.seo?.defaultDescription || settings.store.description || settings.store.tagline;
  const p = urlPath.replace(/\/+$/, '') || '/';
  const canonical = abs(p);

  if (NOINDEX_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) {
    return { title: store, description: defaultDesc, noindex: true, status: 200 };
  }

  if (p === '/') {
    const ld: unknown[] = [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: store,
        url: env.publicUrl,
        potentialAction: { '@type': 'SearchAction', target: `${env.publicUrl}/shop?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      },
    ];
    const a = settings.store.address;
    if (a?.line1 && a.city) {
      ld.push({
        '@context': 'https://schema.org',
        '@type': 'JewelryStore',
        name: settings.store.legalName || store,
        url: env.publicUrl,
        telephone: settings.store.phone || undefined,
        email: settings.store.email || undefined,
        address: {
          '@type': 'PostalAddress',
          streetAddress: [a.line1, a.line2].filter(Boolean).join(', '),
          addressLocality: a.city,
          addressRegion: a.state,
          postalCode: a.pincode,
          addressCountry: 'IN',
        },
        hasMap: settings.store.mapUrl || undefined,
      });
    }
    // The home title already leads with the brand, so no suffix.
    return { title: `${store} · ${settings.store.tagline}`, description: defaultDesc, canonical, jsonLd: ld, status: 200 };
  }

  if (STATIC_PAGES[p]) return { ...STATIC_PAGES[p], title: t(STATIC_PAGES[p].title), canonical, status: 200 };

  let m = p.match(/^\/product\/([a-z0-9-]+)$/);
  if (m) {
    const product = await Product.findOne({ slug: m[1], isActive: true }).lean<LeanProduct>();
    if (!product) return notFoundHead(store);
    const ctx = { rates: ratesFrom(settings), gstRateBps: settings.tax?.gstRateBps ?? 300 };
    const card = toProductCard(product, ctx);
    const crumbs = await categoryPath(product.category);
    const purity = product.purity ? PURITIES[product.purity].label : '';
    const description = clip(product.seo?.description || product.shortDescription || product.description || `${purity} ${product.name}`);
    const images = (product.images ?? []).slice(0, 5).map(imgAbs).filter(Boolean);
    const url = abs(`/product/${product.slug}`);
    return {
      title: t(product.seo?.title || `${product.name}${purity ? ` · ${purity} Gold` : ''}`.replace(' Gold Gold', ' Gold')),
      description,
      canonical: url,
      image: images[0],
      type: 'product',
      status: 200,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          description,
          image: images,
          sku: product.variants[0]?.sku,
          brand: { '@type': 'Brand', name: store },
          category: crumbs.map((c) => c.name).join(' > ') || undefined,
          material: purity || undefined,
          offers:
            card.price > 0
              ? {
                  '@type': 'Offer',
                  url,
                  priceCurrency: 'INR',
                  price: (card.price / 100).toFixed(2),
                  availability: card.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
                  itemCondition: 'https://schema.org/NewCondition',
                }
              : undefined,
          aggregateRating:
            product.ratingCount > 0
              ? { '@type': 'AggregateRating', ratingValue: product.ratingAvg.toFixed(1), reviewCount: product.ratingCount }
              : undefined,
        },
        breadcrumbLd([{ name: 'Shop', url: abs('/shop') }, ...crumbs.map((c) => ({ name: c.name, url: abs(`/shop/${c.slug}`) })), { name: product.name, url }]),
      ],
    };
  }

  m = p.match(/^\/shop\/([a-z0-9-]+)$/);
  if (m) {
    const cat = await Category.findOne({ slug: m[1], isActive: true }).lean();
    if (!cat) return notFoundHead(store);
    const crumbs = await categoryPath(cat._id);
    return {
      title: t(cat.seo?.title || `${cat.name} · Gold jewellery`),
      description: clip(cat.seo?.description || cat.description || `Shop ${cat.name.toLowerCase()} in gold, priced on today’s rate.`),
      canonical,
      image: imgAbs(cat.image as ImageRef | undefined),
      status: 200,
      jsonLd: [breadcrumbLd([{ name: 'Shop', url: abs('/shop') }, ...crumbs.map((c) => ({ name: c.name, url: abs(`/shop/${c.slug}`) }))])],
    };
  }

  m = p.match(/^\/collections\/([a-z0-9-]+)$/);
  if (m) {
    const col = await Collection.findOne({ slug: m[1], isActive: true }).lean();
    if (!col) return notFoundHead(store);
    return {
      title: t(col.seo?.title || `${col.name} collection`),
      description: clip(col.seo?.description || col.tagline || col.description || defaultDesc),
      canonical,
      image: imgAbs(col.image as ImageRef | undefined),
      status: 200,
    };
  }

  m = p.match(/^\/journal\/([a-z0-9-]+)$/);
  if (m) {
    const post = await Post.findOne({ slug: m[1], isPublished: true }).lean();
    if (!post) return notFoundHead(store);
    const image = imgAbs(post.cover as ImageRef | undefined);
    return {
      title: t(post.seo?.title || post.title),
      description: clip(post.seo?.description || post.excerpt || post.body),
      canonical,
      image,
      type: 'article',
      status: 200,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: post.title,
          description: clip(post.excerpt || post.body),
          image: image ? [image] : undefined,
          datePublished: post.publishedAt?.toISOString(),
          dateModified: post.updatedAt?.toISOString(),
          author: post.author ? { '@type': 'Person', name: post.author } : { '@type': 'Organization', name: store },
          publisher: { '@type': 'Organization', name: store },
          mainEntityOfPage: canonical,
        },
      ],
    };
  }

  m = p.match(/^\/policies\/([a-z0-9-]+)$/);
  if (m) {
    const page = await Page.findOne({ slug: m[1], isPublished: true }).lean();
    if (!page) return notFoundHead(store);
    return { title: t(page.seo?.title || page.title), description: clip(page.seo?.description || page.body), canonical, status: 200 };
  }

  return notFoundHead(store);
}

function notFoundHead(store: string): HeadData {
  return { title: `Page not found | ${store}`, description: '', noindex: true, status: 404 };
}

function breadcrumbLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

export function renderHead(h: HeadData, siteName: string): string {
  const tags = [
    `<title>${esc(h.title)}</title>`,
    h.description ? `<meta name="description" content="${esc(h.description)}">` : '',
    h.canonical ? `<link rel="canonical" href="${esc(h.canonical)}">` : '',
    h.noindex ? '<meta name="robots" content="noindex, nofollow">' : '',
    `<meta property="og:site_name" content="${esc(siteName)}">`,
    `<meta property="og:type" content="${h.type ?? 'website'}">`,
    `<meta property="og:title" content="${esc(h.title)}">`,
    h.description ? `<meta property="og:description" content="${esc(h.description)}">` : '',
    h.canonical ? `<meta property="og:url" content="${esc(h.canonical)}">` : '',
    h.image ? `<meta property="og:image" content="${esc(h.image)}">` : '',
    `<meta name="twitter:card" content="${h.image ? 'summary_large_image' : 'summary'}">`,
    ...(h.jsonLd ?? []).map(
      (ld) => `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
    ),
  ];
  // Marked so the client can replace these with its own tags once the app takes over.
  return tags
    .filter(Boolean)
    .map((tag) => tag.replace(/^<(\w+)/, '<$1 data-ssr-head'))
    .join('\n    ');
}

let template: string | null = null;
export async function htmlTemplate(): Promise<string> {
  if (!template || !env.isProd) template = await fs.readFile(path.join(env.clientDist, 'index.html'), 'utf8');
  return template;
}

/** The SEO tags and HTTP status for a storefront path, for a proxy that serves index.html itself. */
export async function pageHead(urlPath: string): Promise<{ head: string; status: number }> {
  const [head, settings] = await Promise.all([headFor(urlPath), getSettings()]);
  return { head: renderHead(head, settings.store.name), status: head.status };
}

/** Keep in step with client/functions/[[path]].ts, which does the same on Cloudflare Pages. */
function injectHead(tpl: string, head: string): string {
  // A function, so "$&" or "$'" in a product description isn't read as a replacement pattern.
  return tpl.replace(/<title>[\s\S]*?<\/title>/, '').replace('<!--app-head-->', () => head);
}

export async function renderPage(urlPath: string): Promise<{ html: string; status: number }> {
  const [tpl, { head, status }] = await Promise.all([htmlTemplate(), pageHead(urlPath)]);
  return { html: injectHead(tpl, head), status };
}

/* ---------------------------------------------------------------- sitemap */

export async function sitemapXml(): Promise<string> {
  return cached('seo:sitemap', 60 * 60_000, async () => {
    const [products, categories, collections, posts, pages] = await Promise.all([
      Product.find({ isActive: true }).select('slug updatedAt').sort({ updatedAt: -1 }).limit(40_000).lean(),
      Category.find({ isActive: true }).select('slug updatedAt').lean(),
      Collection.find({ isActive: true }).select('slug updatedAt').lean(),
      Post.find({ isPublished: true }).select('slug updatedAt').lean(),
      Page.find({ isPublished: true }).select('slug updatedAt').lean(),
    ]);
    const url = (loc: string, lastmod?: Date, priority?: number) =>
      `<url><loc>${esc(abs(loc))}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}${priority ? `<priority>${priority.toFixed(1)}</priority>` : ''}</url>`;
    const entries = [
      url('/', undefined, 1),
      ...Object.keys(STATIC_PAGES).filter((p) => p !== '/track-order').map((p) => url(p, undefined, 0.6)),
      ...categories.map((c) => url(`/shop/${c.slug}`, c.updatedAt, 0.8)),
      ...collections.map((c) => url(`/collections/${c.slug}`, c.updatedAt, 0.7)),
      ...products.map((p) => url(`/product/${p.slug}`, p.updatedAt, 0.9)),
      ...posts.map((p) => url(`/journal/${p.slug}`, p.updatedAt, 0.5)),
      ...pages.map((p) => url(`/policies/${p.slug}`, p.updatedAt, 0.3)),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  });
}

export function robotsTxt(): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /account',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /orders/',
    'Disallow: /api/',
    '',
    `Sitemap: ${env.publicUrl}/sitemap.xml`,
    '',
  ].join('\n');
}
