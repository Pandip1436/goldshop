/**
 * Demonstration catalogue for `npm run seed:demo`. Every record is flagged `demo: true` and can be
 * removed with `npm run seed:clear-demo`. Weights, making charges and stock are illustrative only.
 */
import type { PurityKey } from '@goldshop/shared';

export interface DemoVariant {
  sku: string;
  label?: string;
  attributes?: Record<string, string>;
  /** Grams. */
  weight: number;
  /** Rupees. */
  stone?: number;
  stock: number;
}

export interface DemoProduct {
  name: string;
  category: string;
  collections: string[];
  purity: PurityKey;
  making: { type: 'percent' | 'per_gram' | 'flat'; value: number };
  makingDiscountPercent?: number;
  images: { file: string; fit: 'pad' | 'crop'; detail?: boolean }[];
  short: string;
  description: string;
  specs: [string, string][];
  tags: string[];
  optionNames?: string[];
  variants: DemoVariant[];
  featured?: boolean;
}

export const DEMO_CATEGORIES: { slug: string; name: string; parent?: string; description: string; image?: string; sort: number }[] = [
  { slug: 'earrings', name: 'Earrings', description: 'Jhumkas, chandbalis, drops and everyday studs.', image: 'jhumka-aic', sort: 1 },
  { slug: 'jhumkas', name: 'Jhumkas', parent: 'earrings', description: 'Bell-shaped earrings, from light daily pairs to festive statements.', sort: 1 },
  { slug: 'chandbalis', name: 'Chandbalis', parent: 'earrings', description: 'Crescent-moon earrings with pearls and stones.', sort: 2 },
  { slug: 'drops-and-danglers', name: 'Drops & danglers', parent: 'earrings', description: 'Earrings that move with you.', sort: 3 },
  { slug: 'necklaces', name: 'Necklaces', description: 'Temple necklaces, harams and everyday chains.', image: 'met-dt6630', sort: 2 },
  { slug: 'temple-necklaces', name: 'Temple & heritage', parent: 'necklaces', description: 'South Indian forms, made the traditional way.', sort: 1 },
  { slug: 'chains-and-pendants', name: 'Chains & pendants', parent: 'necklaces', description: 'Fine chains and pendants for every day.', sort: 2 },
  { slug: 'bangles-and-bracelets', name: 'Bangles & bracelets', description: 'Kadas, plain bangles and fine bracelets.', image: 'bangle-bs216', sort: 3 },
  { slug: 'rings', name: 'Rings', description: 'Bands, solitaires and temple rings.', image: 'rings-wedding-pu', sort: 4 },
  { slug: 'gold-bars-and-coins', name: 'Gold bars & coins', description: '24K gold for saving and gifting.', image: 'gold-bar', sort: 5 },
];

export const DEMO_COLLECTIONS: { slug: string; name: string; tagline: string; description: string; image: string; featured: boolean; sort: number }[] = [
  {
    slug: 'temple-heritage',
    name: 'Temple Heritage',
    tagline: 'Forms carried down through generations of South Indian goldsmiths.',
    description: 'Jasmine-bud necklaces, kodi chains and antique-finish temple pieces, made in 22K gold.',
    image: 'met-dt5241',
    featured: true,
    sort: 1,
  },
  {
    slug: 'wedding-and-festive',
    name: 'Wedding & Festive',
    tagline: 'For the days you will remember.',
    description: 'Statement jhumkas, chandbalis, harams and kadas for weddings, festivals and family occasions.',
    image: 'bride-pu',
    featured: true,
    sort: 2,
  },
  {
    slug: 'everyday-gold',
    name: 'Everyday Gold',
    tagline: 'Light pieces made to be worn, not kept for best.',
    description: 'Fine chains, slim bangles and small drops you can wear from morning to night.',
    image: 'neck-bs761',
    featured: true,
    sort: 3,
  },
  {
    slug: 'diamonds-in-gold',
    name: 'Diamonds in Gold',
    tagline: 'Diamonds set in 18K gold.',
    description: 'Bands and solitaires set in 18K gold, which holds stones securely.',
    image: 'ring-fr',
    featured: false,
    sort: 4,
  },
];

const ringSizes = (base: number, step: number, sku: string, stone = 0) =>
  ['10', '12', '14', '16'].map((s, i) => ({ sku: `${sku}-${s}`, label: `Size ${s}`, attributes: { Size: s }, weight: +(base + i * step).toFixed(3), stone, stock: i === 3 ? 1 : 2 }));

const bangleSizes = (base: number, step: number, sku: string, stone = 0) =>
  ['2.4', '2.6', '2.8'].map((s, i) => ({ sku: `${sku}-${s.replace('.', '')}`, label: `Size ${s}`, attributes: { Size: s }, weight: +(base + i * step).toFixed(3), stone, stock: 2 }));

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    name: 'Meenakari Kundan Jhumkas',
    category: 'jhumkas',
    collections: ['wedding-and-festive'],
    purity: 'gold22',
    making: { type: 'percent', value: 14 },
    images: [{ file: 'jhumka-aic', fit: 'pad' }, { file: 'jhumka-aic', fit: 'pad', detail: true }],
    short: 'Floral kundan tops, blue meenakari domes and a fringe of seed pearls.',
    description:
      'A festive pair with a flower-shaped kundan top, a painted meenakari bell and a double fringe of pearls and green beads. Lightweight for its size, with comfortable screw backs.',
    specs: [['Stones', 'Kundan, seed pearls, green glass beads'], ['Finish', 'Meenakari enamel'], ['Closure', 'Screw back'], ['Length', 'Approx. 6.5 cm']],
    tags: ['jhumka', 'kundan', 'meenakari', 'festive', 'pearl'],
    variants: [{ sku: 'IJ-JH-001', weight: 18.6, stone: 6500, stock: 2 }],
    featured: true,
  },
  {
    name: 'Seed Pearl Chandbalis',
    category: 'chandbalis',
    collections: ['wedding-and-festive'],
    purity: 'gold22',
    making: { type: 'percent', value: 15 },
    images: [{ file: 'ear-dorisduke', fit: 'pad' }, { file: 'ear-dorisduke', fit: 'pad', detail: true }],
    short: 'Crescent chandbalis edged with seed pearls and ruby-red stones.',
    description:
      'Classic crescent-moon chandbalis with a kundan-set top, a pierced crescent and clusters of seed pearls. Made to frame the face on wedding days.',
    specs: [['Stones', 'Kundan, seed pearls, red stones'], ['Closure', 'Hook with support chain'], ['Length', 'Approx. 7 cm']],
    tags: ['chandbali', 'pearl', 'bridal', 'festive'],
    variants: [{ sku: 'IJ-CB-001', weight: 14.2, stone: 5200, stock: 1 }],
    featured: true,
  },
  {
    name: 'Pearl Chain Danglers',
    category: 'drops-and-danglers',
    collections: ['wedding-and-festive'],
    purity: 'gold22',
    making: { type: 'percent', value: 15 },
    images: [{ file: 'ear-honolulu', fit: 'pad' }, { file: 'ear-honolulu', fit: 'pad', detail: true }],
    short: 'Long danglers with pearl ear chains that sweep into the hair.',
    description: 'Shoulder-grazing danglers with a carved crescent drop and pearl chains that tuck into the hair — a traditional detail that also takes weight off the ear.',
    specs: [['Stones', 'Seed pearls, white stones'], ['Closure', 'Hook with ear chain'], ['Length', 'Approx. 9 cm']],
    tags: ['danglers', 'pearl', 'festive'],
    variants: [{ sku: 'IJ-DG-001', weight: 11.8, stone: 3800, stock: 2 }],
  },
  {
    name: 'Marigold Drop Earrings',
    category: 'drops-and-danglers',
    collections: ['everyday-gold'],
    purity: 'gold22',
    making: { type: 'percent', value: 12 },
    makingDiscountPercent: 20,
    images: [{ file: 'ear-set-met', fit: 'pad' }, { file: 'ear-set-met', fit: 'pad', detail: true }],
    short: 'Hand-formed gold petals on a fine hoop.',
    description: 'Layered petals in high-polish 22K gold, hanging from a slim wire hoop. Light enough to wear every day.',
    specs: [['Closure', 'Wire hoop'], ['Length', 'Approx. 3 cm']],
    tags: ['drops', 'flower', 'everyday'],
    variants: [{ sku: 'IJ-DR-002', weight: 6.4, stock: 4 }],
  },
  {
    name: 'Bud Drop Earrings',
    category: 'drops-and-danglers',
    collections: ['everyday-gold'],
    purity: 'gold22',
    making: { type: 'percent', value: 10 },
    images: [{ file: 'ear-met-444678', fit: 'crop' }, { file: 'ear-met-444678', fit: 'pad', detail: true }],
    short: 'A small ribbed bud on a curved hook.',
    description: 'A minimal drop with a ribbed bud and a curved hook — an easy first piece of gold.',
    specs: [['Closure', 'Hook'], ['Length', 'Approx. 2.2 cm']],
    tags: ['drops', 'minimal', 'everyday', 'gift'],
    variants: [{ sku: 'IJ-DR-003', weight: 2.9, stock: 6 }],
  },
  {
    name: 'Mullai Arumbu Necklace',
    category: 'temple-necklaces',
    collections: ['temple-heritage', 'wedding-and-festive'],
    purity: 'gold22',
    making: { type: 'percent', value: 16 },
    images: [{ file: 'met-dt6630', fit: 'pad' }, { file: 'met-dt6630', fit: 'pad', detail: true }],
    short: 'A collar of jasmine buds in 22K gold, strung on black silk cord.',
    description:
      'Named after the jasmine bud (mullai arumbu), this necklace lines up dozens of tapering gold buds into a bold collar. It sits close to the neck and ties with a black silk cord.',
    specs: [['Style', 'Mullai arumbu (jasmine bud)'], ['Closure', 'Silk cord tie'], ['Length', 'Adjustable, approx. 38–44 cm']],
    tags: ['temple', 'necklace', 'mullai', 'heritage', 'bridal'],
    variants: [{ sku: 'IJ-TN-001', weight: 38.5, stock: 1 }],
    featured: true,
  },
  {
    name: 'Heritage Kodi Necklace',
    category: 'temple-necklaces',
    collections: ['temple-heritage'],
    purity: 'gold22',
    making: { type: 'percent', value: 16 },
    images: [{ file: 'met-dt5241', fit: 'pad' }, { file: 'met-dt5241', fit: 'pad', detail: true }],
    short: 'Gold barrel beads and spiked medallions on a black cord.',
    description: 'A South Indian kodi-style necklace of hollow gold barrels and radiating medallions with a central pendant, finished on a traditional black cord.',
    specs: [['Style', 'Kodi'], ['Closure', 'Cord tie'], ['Length', 'Approx. 46 cm']],
    tags: ['temple', 'kodi', 'heritage', 'necklace'],
    variants: [{ sku: 'IJ-TN-002', weight: 32, stock: 1 }],
  },
  {
    name: 'Seven-Strand Haram',
    category: 'temple-necklaces',
    collections: ['wedding-and-festive', 'temple-heritage'],
    purity: 'gold22',
    making: { type: 'percent', value: 15 },
    images: [{ file: 'candmala', fit: 'pad' }, { file: 'candmala', fit: 'pad', detail: true }],
    short: 'Seven graduated strands of gold leaves with ruby accents.',
    description: 'A long ceremonial haram with seven graduated strands of hand-cut gold leaves, joined at a stone-set spacer and finished with a pearl drop.',
    specs: [['Stones', 'Rubies, pearl'], ['Closure', 'Hook'], ['Length', 'Approx. 60 cm']],
    tags: ['haram', 'long necklace', 'bridal', 'festive'],
    variants: [{ sku: 'IJ-HR-001', weight: 46, stone: 9000, stock: 1 }],
    featured: true,
  },
  {
    name: 'Gundu Bead Mala with Drops',
    category: 'temple-necklaces',
    collections: ['temple-heritage'],
    purity: 'gold22',
    making: { type: 'per_gram', value: 650 },
    images: [{ file: 'neck-ear-met', fit: 'pad' }, { file: 'neck-ear-met', fit: 'pad', detail: true }],
    short: 'Textured gold gundu beads with matching drop earrings.',
    description: 'A single strand of textured gold beads (gundu) with a matching pair of drop earrings, sold together as a set.',
    specs: [['Set includes', 'Necklace and pair of earrings'], ['Length', 'Approx. 50 cm']],
    tags: ['gundu', 'mala', 'set', 'heritage'],
    variants: [{ sku: 'IJ-GM-001', weight: 24, stock: 2 }],
  },
  {
    name: 'Layered Coin Necklace',
    category: 'chains-and-pendants',
    collections: ['everyday-gold'],
    purity: 'gold18',
    making: { type: 'per_gram', value: 950 },
    images: [{ file: 'neck-bs761', fit: 'crop' }, { file: 'neck-bs761', fit: 'crop', detail: true }],
    short: 'Two fine chains with a tiny coin and a slim bar.',
    description: 'A two-layer necklace in 18K gold with a small disc and a slim bar. Wear it alone or layer it with a longer chain.',
    specs: [['Chain', 'Cable chain'], ['Closure', 'Spring ring'], ['Length', '40 cm + 45 cm']],
    tags: ['layered', 'minimal', 'everyday', 'gift'],
    variants: [{ sku: 'IJ-CH-001', weight: 4.8, stock: 5 }],
  },
  {
    name: 'Halo Circle Pendant Chain',
    category: 'chains-and-pendants',
    collections: ['everyday-gold'],
    purity: 'gold18',
    making: { type: 'per_gram', value: 900 },
    images: [{ file: 'chain-bs762', fit: 'crop' }, { file: 'chain-bs762', fit: 'crop', detail: true }],
    short: 'An open circle on a fine adjustable chain.',
    description: 'A small open circle that sits at the collarbone, on a fine chain with an adjustable extender.',
    specs: [['Chain', 'Cable chain with extender'], ['Length', 'Adjustable 40–45 cm']],
    tags: ['pendant', 'minimal', 'everyday', 'gift'],
    variants: [{ sku: 'IJ-CH-002', weight: 3.2, stock: 6 }],
  },
  {
    name: 'Stone-Set Kada Bangle',
    category: 'bangles-and-bracelets',
    collections: ['wedding-and-festive'],
    purity: 'gold22',
    making: { type: 'percent', value: 13 },
    images: [{ file: 'bangle-bs216', fit: 'crop' }, { file: 'bangle-bs216', fit: 'crop', detail: true }],
    short: 'A slim kada with a row of channel-set stones.',
    description: 'A rounded kada with a single row of channel-set stones, polished to a soft shine. Choose your bangle size.',
    specs: [['Stones', 'Cubic zirconia'], ['Width', 'Approx. 5 mm']],
    tags: ['kada', 'bangle', 'stones', 'festive'],
    optionNames: ['Size'],
    variants: bangleSizes(12.5, 0.6, 'IJ-BG-001', 1800),
  },
  {
    name: 'Classic Plain Bangle',
    category: 'bangles-and-bracelets',
    collections: ['everyday-gold'],
    purity: 'gold22',
    making: { type: 'percent', value: 8 },
    images: [{ file: 'bangle-bs305', fit: 'crop' }, { file: 'bangle-bs305', fit: 'crop', detail: true }],
    short: 'A slim, round-wire bangle for everyday stacking.',
    description: 'The simplest bangle, in round 22K wire. Wear one, or stack several.',
    specs: [['Profile', 'Round wire'], ['Width', 'Approx. 2 mm']],
    tags: ['bangle', 'plain', 'everyday', 'stack'],
    optionNames: ['Size'],
    variants: bangleSizes(6.2, 0.4, 'IJ-BG-002'),
    featured: true,
  },
  {
    name: 'Stacking Bangle Trio',
    category: 'bangles-and-bracelets',
    collections: ['everyday-gold'],
    purity: 'gold18',
    making: { type: 'percent', value: 12 },
    images: [{ file: 'bangles-bs315', fit: 'pad' }, { file: 'bangles-bs315', fit: 'crop', detail: true }],
    short: 'Three slim bangles — textured, stone-set and an open arrow cuff.',
    description: 'A ready-made stack of three: a textured bangle, a stone-set bangle and an open arrow cuff, in 18K gold.',
    specs: [['Set includes', '3 bangles'], ['Stones', 'Cubic zirconia']],
    tags: ['bangle', 'stack', 'set', 'everyday'],
    variants: [{ sku: 'IJ-BG-003', weight: 9.6, stone: 1200, stock: 3 }],
  },
  {
    name: 'Crescent Moon Bracelet',
    category: 'bangles-and-bracelets',
    collections: ['everyday-gold'],
    purity: 'gold18',
    making: { type: 'per_gram', value: 950 },
    images: [{ file: 'bracelet-bs280', fit: 'crop' }, { file: 'bracelet-bs280', fit: 'crop', detail: true }],
    short: 'A fine chain bracelet with a small crescent charm.',
    description: 'A delicate chain bracelet with a crescent-moon charm, adjustable to fit most wrists.',
    specs: [['Chain', 'Cable chain'], ['Length', 'Adjustable 16–19 cm']],
    tags: ['bracelet', 'moon', 'minimal', 'gift'],
    variants: [{ sku: 'IJ-BR-001', weight: 2.6, stock: 5 }],
  },
  {
    name: 'Diamond Half-Eternity Band',
    category: 'rings',
    collections: ['diamonds-in-gold'],
    purity: 'gold18',
    making: { type: 'percent', value: 14 },
    images: [{ file: 'ring-fr', fit: 'crop' }, { file: 'ring-fr', fit: 'crop', detail: true }],
    short: 'A row of channel-set diamonds across the top of an 18K band.',
    description: 'Round diamonds channel-set halfway around a comfortable 18K band. Choose your ring size.',
    specs: [['Diamonds', 'Round brilliant, approx. 0.25 ct total'], ['Band width', 'Approx. 2.5 mm']],
    tags: ['diamond', 'band', 'ring', 'anniversary'],
    optionNames: ['Size'],
    variants: ringSizes(2.8, 0.2, 'IJ-RG-001', 18500),
    featured: true,
  },
  {
    name: 'Solitaire Promise Ring',
    category: 'rings',
    collections: ['diamonds-in-gold'],
    purity: 'gold18',
    making: { type: 'percent', value: 15 },
    images: [{ file: 'ring-fr-diamond', fit: 'crop' }, { file: 'ring-fr-diamond', fit: 'crop', detail: true }],
    short: 'A single diamond in a four-prong setting on a tapered 18K band.',
    description: 'One round diamond held high in a four-prong setting on a gently tapered band.',
    specs: [['Diamond', 'Round brilliant, approx. 0.30 ct'], ['Setting', 'Four prong']],
    tags: ['diamond', 'solitaire', 'ring', 'engagement'],
    optionNames: ['Size'],
    variants: ringSizes(2.4, 0.15, 'IJ-RG-002', 42000),
  },
  {
    name: 'Classic Wedding Bands',
    category: 'rings',
    collections: ['wedding-and-festive'],
    purity: 'gold22',
    making: { type: 'per_gram', value: 600 },
    images: [{ file: 'rings-wedding-pu', fit: 'pad' }, { file: 'rings-wedding-pu', fit: 'pad', detail: true }],
    short: 'A matched pair of high-polish comfort-fit bands.',
    description: 'A pair of rounded wedding bands in 22K gold with a comfort-fit inner edge. Sizes can be specified after ordering.',
    specs: [['Set includes', '2 rings'], ['Profile', 'Comfort fit'], ['Sizing', 'Confirmed after order']],
    tags: ['wedding', 'band', 'pair', 'ring'],
    variants: [{ sku: 'IJ-RG-003', weight: 9.2, stock: 3 }],
  },
  {
    name: 'Antique Temple Ring',
    category: 'rings',
    collections: ['temple-heritage'],
    purity: 'gold22',
    making: { type: 'percent', value: 18 },
    images: [{ file: 'toe-ring', fit: 'pad' }, { file: 'toe-ring', fit: 'pad', detail: true }],
    short: 'A sculpted ring with an antique finish and a single pearl.',
    description: 'A bold, sculpted ring with an antique finish that brings out its relief work, finished with a single pearl.',
    specs: [['Finish', 'Antique'], ['Stones', 'Pearl']],
    tags: ['temple', 'ring', 'antique', 'heritage'],
    variants: [{ sku: 'IJ-RG-004', weight: 10.4, stone: 400, stock: 1 }],
  },
  {
    name: '24K Gold Bar',
    category: 'gold-bars-and-coins',
    collections: [],
    purity: 'gold24',
    making: { type: 'flat', value: 450 },
    images: [{ file: 'gold-bar', fit: 'crop' }, { file: 'gold-bar', fit: 'crop', detail: true }],
    short: '999 fine gold bars in tamper-evident packaging.',
    description: '24K (999) gold bars for saving or gifting. Choose the weight; the price follows today’s 24K rate.',
    specs: [['Fineness', '999'], ['Packaging', 'Tamper-evident card']],
    tags: ['gold bar', '24k', 'investment', 'gift'],
    optionNames: ['Weight'],
    variants: [
      { sku: 'IJ-GB-1G', label: '1 g', attributes: { Weight: '1 g' }, weight: 1, stock: 10 },
      { sku: 'IJ-GB-5G', label: '5 g', attributes: { Weight: '5 g' }, weight: 5, stock: 5 },
      { sku: 'IJ-GB-10G', label: '10 g', attributes: { Weight: '10 g' }, weight: 10, stock: 3 },
    ],
  },
];

/** Illustrative demo rates in rupees per gram. Real rates must be entered daily in the admin. */
export const DEMO_RATES_RUPEES = { gold24: 12_800, gold22: 11_730, gold18: 9_600, gold14: 7_470 };

export const DEMO_BANNERS = [
  {
    eyebrow: 'Temple Heritage',
    title: 'Gold that *remembers* where it came from',
    subtitle: 'Jasmine-bud collars, kodi chains and temple rings in 22K gold — every price shown in full, at today’s rate.',
    ctaLabel: 'Explore the collection',
    ctaHref: '/collections/temple-heritage',
    secondaryLabel: 'How we price',
    secondaryHref: '/journal/how-our-prices-are-calculated',
    image: 'met-dt6630',
    theme: 'dark' as const,
    align: 'left' as const,
  },
];
