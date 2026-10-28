import { z } from 'zod';
import {
  INDIAN_STATES,
  MAKING_CHARGE_TYPES,
  ORDER_STATUSES,
  PRICING_MODES,
  PURITY_KEYS,
  ROLES,
  gstinSchema,
  emailSchema,
  nameSchema,
  passwordSchema,
} from '@goldshop/shared';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, { message: 'Invalid id' });
const paise = z.number().int().min(0).max(10_000_000_000);
const text = (max: number) => z.string().trim().max(max);
const optionalDate = z
  .union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? new Date(v) : null));
/** Internal paths or http(s) URLs only — never javascript: or data: links. */
const href = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || v.startsWith('/') || /^https?:\/\//i.test(v), { message: 'Use a path like /shop or a full https:// link' })
  .default('');

export const imageRefSchema = z.object({
  key: text(200).default(''),
  url: z.string().url().max(500).optional(),
  alt: text(200).default(''),
  width: z.number().int().min(0).max(20000).default(0),
  height: z.number().int().min(0).max(20000).default(0),
});

export const seoInput = z.object({ title: text(120).optional(), description: text(320).optional() }).default({});

export const variantInput = z.object({
  id: oid.optional(),
  sku: z.string().trim().min(1, { message: 'SKU is required' }).max(60).toUpperCase(),
  label: text(60).default('Standard'),
  attributes: z.record(z.string().max(40), z.string().max(60)).default({}),
  netWeightMg: z.number().int().min(0).max(10_000_000).default(0),
  grossWeightMg: z.number().int().min(0).max(10_000_000).default(0),
  stoneCharge: paise.default(0),
  fixedPrice: paise.default(0),
  compareAtPrice: paise.default(0),
  /** Only used for new variants; existing stock changes go through the inventory endpoint. */
  stock: z.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true),
});

export const productInput = z
  .object({
    name: z.string().trim().min(2).max(140),
    slug: text(160).optional(),
    shortDescription: text(400).default(''),
    description: text(8000).default(''),
    category: oid,
    collections: z.array(oid).max(20).default([]),
    tags: z.array(z.string().trim().toLowerCase().max(40)).max(30).default([]),
    purity: z.enum(PURITY_KEYS).optional().nullable(),
    pricingMode: z.enum(PRICING_MODES).default('weight'),
    making: z.object({ type: z.enum(MAKING_CHARGE_TYPES), value: z.number().min(0).max(1_000_000_000) }).default({ type: 'percent', value: 0 }),
    makingDiscountPercent: z.number().min(0).max(100).default(0),
    variants: z.array(variantInput).min(1, { message: 'Add at least one variant' }).max(50),
    optionNames: z.array(text(40)).max(3).default([]),
    specs: z.array(z.object({ label: text(60), value: text(300) })).max(30).default([]),
    images: z.array(imageRefSchema).max(15).default([]),
    isActive: z.boolean().default(true),
    isFeatured: z.boolean().default(false),
    sortOrder: z.number().int().min(-10000).max(10000).default(0),
    seo: seoInput,
  })
  .superRefine((p, ctx) => {
    const skus = new Set<string>();
    p.variants.forEach((v, i) => {
      if (skus.has(v.sku)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'sku'], message: 'SKUs must be unique' });
      skus.add(v.sku);
      if (p.pricingMode === 'weight' && v.isActive && v.netWeightMg <= 0)
        ctx.addIssue({ code: 'custom', path: ['variants', i, 'netWeightMg'], message: 'Net weight is required for weight-based pricing' });
      if (p.pricingMode === 'fixed' && v.isActive && v.fixedPrice <= 0)
        ctx.addIssue({ code: 'custom', path: ['variants', i, 'fixedPrice'], message: 'Price is required' });
    });
    if (p.pricingMode === 'weight' && !p.purity) ctx.addIssue({ code: 'custom', path: ['purity'], message: 'Choose a purity' });
    if (p.making.type === 'percent' && p.making.value > 100)
      ctx.addIssue({ code: 'custom', path: ['making', 'value'], message: 'Percentage cannot exceed 100' });
  });
export type ProductInput = z.output<typeof productInput>;

export const categoryInput = z.object({
  name: z.string().trim().min(2).max(80),
  slug: text(100).optional(),
  parent: oid.nullable().optional(),
  description: text(1000).default(''),
  image: imageRefSchema.nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  seo: seoInput,
});

export const collectionInput = z.object({
  name: z.string().trim().min(2).max(80),
  slug: text(100).optional(),
  eyebrow: text(40).default(''),
  tagline: text(160).default(''),
  description: text(2000).default(''),
  image: imageRefSchema.nullable().optional(),
  banner: imageRefSchema.nullable().optional(),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  seo: seoInput,
});

export const couponInput = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, { message: '3–30 letters, numbers, - or _' }),
    description: text(200).default(''),
    type: z.enum(['percent', 'flat']),
    value: z.number().min(0),
    scope: z.enum(['order', 'making']).default('order'),
    maxDiscount: paise.default(0),
    minSubtotal: paise.default(0),
    startsAt: optionalDate,
    endsAt: optionalDate,
    usageLimit: z.number().int().min(0).default(0),
    perCustomerLimit: z.number().int().min(0).default(1),
    firstOrderOnly: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    if (c.type === 'percent' && (c.value <= 0 || c.value > 100))
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Percent must be between 1 and 100' });
    if (c.type === 'flat' && (!Number.isInteger(c.value) || c.value <= 0))
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter an amount' });
    if (c.startsAt && c.endsAt && c.endsAt < c.startsAt)
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End date must be after the start date' });
  });

export const bannerInput = z.object({
  eyebrow: text(60).default(''),
  title: z.string().trim().min(2).max(120),
  subtitle: text(300).default(''),
  ctaLabel: text(40).default(''),
  ctaHref: href,
  secondaryLabel: text(40).default(''),
  secondaryHref: href,
  image: imageRefSchema.nullable().optional(),
  mobileImage: imageRefSchema.nullable().optional(),
  script: text(90).default(''),
  points: text(200).default(''),
  theme: z.enum(['light', 'dark']).default('dark'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  layout: z.enum(['split', 'full']).default('split'),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  startsAt: optionalDate,
  endsAt: optionalDate,
});

export const testimonialInput = z.object({
  name: z.string().trim().min(2).max(80),
  location: text(80).default(''),
  quote: z.string().trim().min(5).max(600),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  source: text(60).default(''),
  isPublished: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const pageInput = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/),
  title: z.string().trim().min(2).max(120),
  body: text(60000).default(''),
  isPublished: z.boolean().default(true),
  seo: seoInput,
});

export const postInput = z.object({
  title: z.string().trim().min(2).max(160),
  slug: text(180).optional(),
  excerpt: text(400).default(''),
  body: text(60000).default(''),
  cover: imageRefSchema.nullable().optional(),
  author: text(80).default(''),
  tags: z.array(z.string().trim().toLowerCase().max(40)).max(10).default([]),
  isPublished: z.boolean().default(false),
  publishedAt: optionalDate,
  seo: seoInput,
});

export const faqInput = z.object({
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(2).max(4000),
  group: text(60).default('General'),
  sortOrder: z.number().int().default(0),
  isPublished: z.boolean().default(true),
});

export const orderStatusInput = z.object({
  status: z.enum(ORDER_STATUSES),
  note: text(300).default(''),
  notify: z.boolean().default(true),
  restock: z.boolean().default(true),
});

export const shipmentInput = z.object({
  carrier: text(60).default(''),
  trackingNumber: text(80).default(''),
  trackingUrl: z.union([z.string().trim().url().max(400).refine((v) => /^https?:\/\//i.test(v)), z.literal('')]).default(''),
});

export const refundInput = z.object({
  amount: z.number().int().min(100),
  reason: text(200).default(''),
});

export const zoneInput = z.object({
  name: z.string().trim().min(2).max(60),
  states: z.array(z.enum(INDIAN_STATES)).default([]),
  pinPrefixes: z.array(z.string().trim().regex(/^[1-9][0-9]{0,5}$/, { message: 'PIN prefixes are 1–6 digits' })).max(200).default([]),
  rate: paise.default(0),
  freeAbove: paise.default(0),
  codAvailable: z.boolean().default(false),
  etaMinDays: z.number().int().min(0).max(60).default(3),
  etaMaxDays: z.number().int().min(0).max(60).default(7),
  isActive: z.boolean().default(true),
});

export const settingsInput = z.object({
  store: z
    .object({
      name: z.string().trim().min(2).max(60),
      legalName: text(120).default(''),
      tagline: text(140).default(''),
      description: text(600).default(''),
      email: z.union([emailSchema, z.literal('')]).default(''),
      phone: text(20).default(''),
      whatsapp: text(20).default(''),
      address: z.object({
        line1: text(120).default(''),
        line2: text(120).default(''),
        city: text(60).default(''),
        state: z.union([z.enum(INDIAN_STATES), z.literal('')]).default(''),
        pincode: z.union([z.string().regex(/^[1-9][0-9]{5}$/), z.literal('')]).default(''),
      }),
      mapUrl: z.union([z.string().url().max(500), z.literal('')]).default(''),
      hours: text(200).default(''),
      gstin: z.union([gstinSchema, z.literal('')]).default(''),
      social: z.object({
        instagram: z.union([z.string().url().max(300), z.literal('')]).default(''),
        facebook: z.union([z.string().url().max(300), z.literal('')]).default(''),
        youtube: z.union([z.string().url().max(300), z.literal('')]).default(''),
        pinterest: z.union([z.string().url().max(300), z.literal('')]).default(''),
      }),
    })
    .optional(),
  displayRates: z.array(z.enum(PURITY_KEYS)).max(6).optional(),
  tax: z.object({ gstRateBps: z.number().int().min(0).max(2800), hsnCode: text(10).default('7113') }).optional(),
  checkout: z
    .object({
      guestCheckout: z.boolean(),
      orderPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{1,4}$/, { message: '1–4 letters' }),
      codEnabled: z.boolean(),
      codMaxOrderValue: paise,
      codFee: paise,
      returnWindowDays: z.number().int().min(0).max(90),
    })
    .optional(),
  shipping: z
    .object({
      zones: z.array(zoneInput).max(50),
      fallbackEnabled: z.boolean(),
      fallbackRate: paise,
      fallbackFreeAbove: paise,
      fallbackCod: z.boolean(),
      fallbackEtaMin: z.number().int().min(0).max(60),
      fallbackEtaMax: z.number().int().min(0).max(60),
      note: text(300).default(''),
    })
    .optional(),
  announcement: z.object({ enabled: z.boolean(), text: text(160), href }).optional(),
  benefits: z.array(z.object({ title: text(60), text: text(200), icon: text(30).default('') })).max(6).optional(),
  stats: z.array(z.object({ value: text(20), label: text(60), icon: text(30).default('') })).max(6).optional(),
  storyChapters: z
    .array(
      z.object({
        title: text(60),
        eyebrow: text(60).default(''),
        body: text(400).default(''),
        image: imageRefSchema.nullable().optional(),
        features: z.array(z.object({ icon: text(30).default(''), value: text(12).default(''), label: text(40) })).max(3).default([]),
      }),
    )
    .max(8)
    .optional(),
  about: z
    .object({
      enabled: z.boolean(),
      eyebrow: text(40).default(''),
      title: text(80).default(''),
      highlight: text(80).default(''),
      tagline: text(120).default(''),
      body: text(2000).default(''),
      badge: text(80).default(''),
      features: z.array(z.object({ label: text(60), icon: text(30).default('') })).max(4).default([]),
      image: imageRefSchema.nullable().optional(),
      insetImage: imageRefSchema.nullable().optional(),
    })
    .optional(),
  goldRatePage: z
    .object({
      image: imageRefSchema.nullable().optional(),
      script: text(90).default(''),
      highlights: z.array(z.object({ title: text(60), text: text(120).default(''), icon: text(30).default('') })).max(6).default([]),
      purityImages: z.object(Object.fromEntries(PURITY_KEYS.map((k) => [k, imageRefSchema.nullable().optional()]))).optional(),
    })
    .optional(),
  footer: z
    .object({
      highlights: z.array(z.object({ title: text(60), text: text(80).default(''), icon: text(30).default('') })).max(4).default([]),
      image: imageRefSchema.nullable().optional(),
    })
    .optional(),
  shopPage: z
    .object({
      image: imageRefSchema.nullable().optional(),
      tagline: text(120).default(''),
      features: z.array(z.object({ title: text(40), text: text(60).default(''), icon: text(30).default('') })).max(3).default([]),
    })
    .optional(),
  collectionsPage: z.object({ image: imageRefSchema.nullable().optional(), subtitle: text(200).default('') }).optional(),
  contactPage: z
    .object({
      image: imageRefSchema.nullable().optional(),
      subtitle: text(240).default(''),
      replyNote: text(60).default(''),
      highlights: z.array(z.object({ title: text(60), text: text(80).default(''), icon: text(30).default('') })).max(6).default([]),
    })
    .optional(),
  wishlistPage: z.object({ image: imageRefSchema.nullable().optional() }).optional(),
  accountPage: z.object({ image: imageRefSchema.nullable().optional() }).optional(),
  helpPage: z.object({ image: imageRefSchema.nullable().optional() }).optional(),
  visitSection: z.object({ image: imageRefSchema.nullable().optional() }).optional(),
  storePhotos: z
    .object({ title: text(80).default(''), subtitle: text(240).default(''), images: z.array(imageRefSchema).max(12).default([]) })
    .optional(),
  brand: z.object({ logo: imageRefSchema.nullable().optional(), mark: imageRefSchema.nullable().optional() }).optional(),
  homePage: z
    .object({
      pricingImage: imageRefSchema.nullable().optional(),
      savingsImage: imageRefSchema.nullable().optional(),
      trust: z.array(z.object({ title: text(60), text: text(80).default(''), icon: text(30).default('') })).max(6).default([]),
      promos: z
        .array(z.object({ title: text(60), text: text(120).default(''), ctaLabel: text(30).default(''), href, image: imageRefSchema.nullable().optional() }))
        .max(3)
        .default([]),
      circles: z
        .array(
          z.object({
            kind: z.enum(['category', 'collection', 'link']),
            ref: text(120).default(''),
            label: text(40).default(''),
            href,
            image: imageRefSchema.nullable().optional(),
          }),
        )
        .max(16)
        .default([]),
    })
    .optional(),
  journalPage: z.object({ image: imageRefSchema.nullable().optional(), script: text(90).default('') }).optional(),
  savingsPlan: z
    .object({
      enabled: z.boolean(),
      summary: text(600),
      image: imageRefSchema.nullable().optional(),
      stepsImage: imageRefSchema.nullable().optional(),
      tagline: text(120).default(''),
      script: text(90).default(''),
      features: z.array(z.object({ title: text(40), text: text(80).default(''), icon: text(30).default('') })).max(4).default([]),
      schemes: z
        .array(
          z.object({
            title: text(60),
            eyebrow: text(60).default(''),
            points: z.array(text(80)).max(3).default([]),
            image: imageRefSchema.nullable().optional(),
            details: text(1500).default(''),
          }),
        )
        .max(4)
        .default([]),
      highlights: z.array(z.object({ title: text(60), text: text(80).default(''), icon: text(30).default('') })).max(6).default([]),
    })
    .optional(),
  seo: z.object({ titleSuffix: text(60), defaultDescription: text(320) }).optional(),
});

export const goldRatesInput = z.object({
  rates: z.object(Object.fromEntries(PURITY_KEYS.map((k) => [k, paise.optional()])) as Record<(typeof PURITY_KEYS)[number], z.ZodOptional<typeof paise>>),
});

export const staffInput = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema.optional(),
  role: z.enum(ROLES).refine((r) => r !== 'customer', { message: 'Choose staff or admin' }),
});

export const staffUpdateInput = z.object({
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
});
