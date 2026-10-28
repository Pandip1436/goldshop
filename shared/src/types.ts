import type { EnquiryType, MakingChargeType, OrderStatus, PaymentMethod, PaymentStatus, PricingMode, ProductSort, PurityKey, Role, OrderGroup } from './constants';

/** An uploaded image. Files are served at `/uploads/{key}-{width}.webp` for each generated width. */
export interface ImageRef {
  key: string;
  alt: string;
  width: number;
  height: number;
  /** Absolute URL for externally hosted images (e.g. CDN). When set, `key` is ignored. */
  url?: string;
}

export interface PriceBreakdown {
  mode: PricingMode;
  /** Value of the metal at today's rate (weight mode only). */
  metalValue: number;
  /** Making charges before any discount. */
  making: number;
  makingDiscount: number;
  stone: number;
  /** Value before GST. */
  taxable: number;
  gst: number;
  /** Final price including GST, rounded to the rupee. */
  total: number;
  ratePerGram?: number;
  purity?: PurityKey;
  netWeightMg?: number;
}

export interface CategoryRef {
  id: string;
  name: string;
  slug: string;
}

export interface CategoryNode extends CategoryRef {
  description?: string;
  image?: ImageRef;
  productCount?: number;
  children: CategoryNode[];
}

export interface CollectionDTO {
  id: string;
  name: string;
  slug: string;
  eyebrow?: string;
  tagline?: string;
  description?: string;
  image?: ImageRef;
  /** Wide photo, when the collection has one. */
  banner?: ImageRef;
  isFeatured: boolean;
}

export interface ProductCardDTO {
  id: string;
  slug: string;
  name: string;
  image?: ImageRef;
  hoverImage?: ImageRef;
  purity?: PurityKey;
  weightMg?: number;
  /** Lowest current price across active variants, in paise. */
  price: number;
  /** True when variants have different prices, so the card shows "From". */
  priceFrom: boolean;
  compareAtPrice?: number;
  inStock: boolean;
  makingDiscountPercent: number;
  ratingAvg: number;
  ratingCount: number;
  category?: CategoryRef;
  /** Present when the product has exactly one purchasable variant, enabling quick add. */
  quickAddVariantId?: string;
  /** Earned from real data only: top sellers by actual sales, and the most recent additions. */
  badges?: ('bestseller' | 'new')[];
}

export interface VariantDTO {
  id: string;
  sku: string;
  label: string;
  attributes: Record<string, string>;
  netWeightMg?: number;
  grossWeightMg?: number;
  inStock: boolean;
  /** Units purchasable right now, capped at the per-order maximum. */
  available: number;
  /** Set only when genuine stock is very low. */
  lowStock?: number;
  price: PriceBreakdown;
  compareAtPrice?: number;
}

export interface SpecDTO {
  label: string;
  value: string;
}

export interface ProductDetailDTO extends ProductCardDTO {
  shortDescription: string;
  description: string;
  images: ImageRef[];
  categoryPath: CategoryRef[];
  collections: CategoryRef[];
  specs: SpecDTO[];
  variants: VariantDTO[];
  optionNames: string[];
  pricingMode: PricingMode;
  making?: { type: MakingChargeType; value: number };
  tags: string[];
  goldRatesUpdatedAt?: string;
  seo?: { title?: string; description?: string };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface ProductListResponse extends Paginated<ProductCardDTO> {
  facets: {
    purities: { key: PurityKey; count: number }[];
    priceMin: number;
    priceMax: number;
    /** Collections the matching pieces belong to (ignoring any collection filter), with counts. */
    collections: { slug: string; name: string; count: number }[];
  };
}

export interface ProductQuery {
  q?: string;
  category?: string;
  collection?: string;
  purity?: string;
  min?: number;
  max?: number;
  inStock?: boolean;
  sort?: ProductSort;
  page?: number;
  limit?: number;
  tag?: string;
}

export interface SearchSuggestions {
  products: Pick<ProductCardDTO, 'id' | 'slug' | 'name' | 'image' | 'price' | 'purity'>[];
  categories: CategoryRef[];
  collections: CategoryRef[];
}

export interface CartLineDTO {
  id: string;
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  variantLabel: string;
  image?: ImageRef;
  purity?: PurityKey;
  netWeightMg?: number;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  maxQty: number;
  /** Human-readable problem with this line (sold out, quantity reduced, price changed…). */
  issue?: string;
  unavailable?: boolean;
}

export interface ShippingQuote {
  serviceable: boolean;
  pincode: string;
  zoneName?: string;
  amount: number;
  freeAbove?: number;
  etaMinDays?: number;
  etaMaxDays?: number;
  codAvailable: boolean;
  message?: string;
  city?: string;
  state?: string;
}

export interface CouponState {
  code: string;
  valid: boolean;
  discount: number;
  description?: string;
  message?: string;
}

export interface CartDTO {
  lines: CartLineDTO[];
  itemCount: number;
  subtotal: number;
  coupon?: CouponState;
  discount: number;
  shipping?: ShippingQuote;
  codFee: number;
  total: number;
  gstIncluded: number;
  issues: string[];
  goldRatesUpdatedAt?: string;
}

export interface StoreAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface TrustItem {
  title: string;
  text: string;
  icon?: string;
}

export interface StatItem {
  value: string;
  label: string;
  icon?: string;
}

/** One of the savings plans on offer, shown as a card on the savings plan page. */
export interface SavingsScheme {
  title: string;
  eyebrow?: string;
  /** Up to three short points. */
  points: string[];
  image?: ImageRef;
  /** The plan's terms in the store's words; without them the card's button asks about the plan instead. */
  details?: string;
}

/** One card of the Our story page's chapters; the number shown on it comes from its position. */
export interface StoryChapter {
  title: string;
  eyebrow?: string;
  body: string;
  image?: ImageRef;
  /** Up to three points along the foot of the card: an icon and a label, optionally with a figure. */
  features: { icon?: string; value?: string; label: string }[];
}

/** Brand story section (homepage and About page). Present only when enabled in settings. */
export interface AboutSection {
  eyebrow?: string;
  title: string;
  highlight?: string;
  tagline?: string;
  /** Paragraphs separated by blank lines. */
  body: string;
  badge?: string;
  features: { label: string; icon?: string }[];
  image?: ImageRef;
  insetImage?: ImageRef;
}

/** The public gold-rate page: current rates, a genuine 24-hour comparison and the page's own content. */
export interface GoldRatesDTO {
  /** Paise per gram, only for purities the store sells. */
  rates: Partial<Record<PurityKey, number>>;
  updatedAt?: string;
  /**
   * The rates the store was using 24 hours ago, read from the rate history. Absent until there is
   * at least a day of history, so no change is ever shown that the store didn't actually make.
   */
  previous?: Partial<Record<PurityKey, number>>;
  page: {
    image?: ImageRef;
    /** Short script lines shown over the photo. */
    script: string[];
    highlights: TrustItem[];
    /** A photo for each purity's rate card; a coin is drawn for any without one. */
    purityImages: Partial<Record<PurityKey, ImageRef>>;
  };
}

/**
 * The rates the store has set, oldest first, for the rate trend. The first point may come from
 * before `since` (the rate that was in force when the period began).
 */
export interface GoldRateHistoryDTO {
  since: string;
  points: { at: string; rates: Partial<Record<PurityKey, number>> }[];
}

export interface PublicSettings {
  store: {
    name: string;
    legalName?: string;
    tagline: string;
    description: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    address?: StoreAddress;
    mapUrl?: string;
    hours?: string;
    gstin?: string;
    social: { instagram?: string; facebook?: string; youtube?: string; pinterest?: string };
  };
  goldRates: Partial<Record<PurityKey, number>> & { updatedAt?: string };
  displayRates: PurityKey[];
  payments: {
    razorpay: boolean;
    cod: { enabled: boolean; maxOrderValue?: number; fee: number };
  };
  /** freeAbove: 0 when delivery is always free. nationwide: delivers to any PIN code in India. */
  shipping: { freeAbove?: number; note?: string; nationwide: boolean };
  announcement: { enabled: boolean; text: string; href?: string };
  benefits: TrustItem[];
  stats: StatItem[];
  /** The Our story page's chapter cards, in order; empty hides the section. */
  storyChapters: StoryChapter[];
  about?: AboutSection;
  /** The band above the footer (placeholders already filled in) and the footer photo. */
  footer: { highlights: TrustItem[]; image?: ImageRef };
  /** The shop listing banner: photo, tagline and up to three short points. */
  shopPage: { image?: ImageRef; tagline?: string; features: TrustItem[] };
  /** The collections page banner. */
  collectionsPage: { image?: ImageRef; subtitle?: string };
  /** The contact page banner. */
  contactPage: {
    image?: ImageRef;
    subtitle?: string;
    /** Under the email card, e.g. a reply time the store keeps. */
    replyNote?: string;
    /** Up to six points in the band at the foot of the page (the footer's own band is left out there). */
    highlights: TrustItem[];
  };
  /** The wishlist page banner. */
  wishlistPage: { image?: ImageRef };
  /** The account pages banner. */
  accountPage: { image?: ImageRef };
  /** Banner photo for the help pages (track order, FAQs). */
  helpPage: { image?: ImageRef };
  /** Photo in the "Visit us" section. */
  visitSection: { image?: ImageRef };
  /** Photographs of the shop itself for the Our story page; empty until the store uploads some. Each photo's alt text is its caption. */
  storePhotos: { title?: string; subtitle?: string; images: ImageRef[] };
  /** The store's logo (full lockup) and its mark alone; absent until uploaded. */
  brand: { logo?: ImageRef; mark?: ImageRef };
  /** Photos for homepage sections. */
  homePage: {
    pricingImage?: ImageRef;
    savingsImage?: ImageRef;
    /** The row of up to six points under the hero. */
    trust: TrustItem[];
    /** Up to three tiles under the categories; one linking to /gold-rate also shows the current rate. */
    promos: { title: string; text?: string; ctaLabel: string; href: string; image?: ImageRef }[];
  };
  /** The journal page banner: photo and the script words over it. */
  journal: { image?: ImageRef; script: string[] };
  gstRateBps: number;
  guestCheckout: boolean;
  savingsPlan: {
    enabled: boolean;
    summary: string;
    image?: ImageRef;
    stepsImage?: ImageRef;
    /** The short line under the heading. */
    tagline?: string;
    /** Script words over the photo, one per line. */
    script: string[];
    /** Up to four short points under the page heading. */
    features: TrustItem[];
    /** The plans on offer, in order. */
    schemes: SavingsScheme[];
    /** Up to six points in the band under the plans. */
    highlights: TrustItem[];
  };
  returnWindowDays?: number;
}

export interface BannerDTO {
  id: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  image?: ImageRef;
  mobileImage?: ImageRef;
  /** Script words shown over the photo, one per line. */
  script?: string[];
  /** Up to three short trust points under the button, e.g. "BIS hallmarked gold jewellery". */
  points?: string[];
  theme: 'light' | 'dark';
  align: 'left' | 'center' | 'right';
  layout: 'split' | 'full';
}

export interface TestimonialDTO {
  id: string;
  name: string;
  location?: string;
  quote: string;
  rating?: number;
  source?: string;
}

export interface PostSummaryDTO {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  cover?: ImageRef;
  publishedAt: string;
  readingMinutes: number;
  tags: string[];
}

export interface PostDTO extends PostSummaryDTO {
  body: string;
  author?: string;
}

export interface PageDTO {
  slug: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface FaqDTO {
  id: string;
  question: string;
  answer: string;
  group: string;
}

/** One circle in the homepage row, as chosen in Settings → Homepage. */
export interface HomeCircle {
  label: string;
  href: string;
  image?: ImageRef;
}

export interface HomeDTO {
  banners: BannerDTO[];
  categories: CategoryNode[];
  /** The circles the store chose, in order; absent until it chooses, when every category with pieces is shown. */
  circles?: HomeCircle[];
  collections: CollectionDTO[];
  featured: ProductCardDTO[];
  bestsellers: ProductCardDTO[];
  newArrivals: ProductCardDTO[];
  testimonials: TestimonialDTO[];
  posts: PostSummaryDTO[];
}

export interface ReviewDTO {
  id: string;
  rating: number;
  title?: string;
  body: string;
  authorName: string;
  createdAt: string;
  verifiedPurchase: boolean;
}

export interface ReviewsResponse extends Paginated<ReviewDTO> {
  ratingAvg: number;
  ratingCount: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  canReview: boolean;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  marketingConsent: boolean;
}

export interface SavedAddressDTO {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export interface OrderItemDTO {
  productId: string;
  slug: string;
  name: string;
  variantLabel: string;
  sku: string;
  image?: ImageRef;
  purity?: PurityKey;
  netWeightMg?: number;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  breakdown: PriceBreakdown;
}

export interface OrderPricingDTO {
  subtotal: number;
  discount: number;
  shipping: number;
  codFee: number;
  total: number;
  taxableValue: number;
  gstAmount: number;
  gstRateBps: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface OrderDTO {
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: string; note?: string }[];
  customer: { name: string; email: string; phone: string };
  shippingAddress: SavedAddressDTO | Omit<SavedAddressDTO, 'id' | 'label' | 'isDefault'>;
  items: OrderItemDTO[];
  pricing: OrderPricingDTO;
  coupon?: { code: string; discount: number };
  payment: { method: PaymentMethod; status: PaymentStatus; paidAt?: string; reference?: string };
  shipment?: { carrier?: string; trackingNumber?: string; trackingUrl?: string; shippedAt?: string; deliveredAt?: string };
  invoiceNumber?: string;
  gstin?: string;
  seller?: { name: string; legalName: string; gstin: string; phone: string; email: string; hsnCode: string; address: StoreAddress & { line2: string } };
  notes?: string;
  canCancel: boolean;
  canPay: boolean;
  goldRates?: Partial<Record<PurityKey, number>>;
}

export interface OrderSummaryDTO {
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  total: number;
  itemCount: number;
  firstItem?: { name: string; image?: ImageRef; slug?: string; purity?: PurityKey; netWeightMg?: number; variantLabel?: string };
  paymentStatus: PaymentStatus;
  /** When each stage was reached, from the order's own status history. */
  progress?: { placed: string; processing?: string; shipped?: string; delivered?: string; cancelled?: string; returned?: string };
  trackingUrl?: string;
  /** What was bought, so it can be added to the bag again at today's price. */
  lines?: { productId: string; variantId: string; qty: number }[];
}

/** The customer's order list: a page of orders plus how many are in each group. */
export interface MyOrdersResponse extends Paginated<OrderSummaryDTO> {
  counts: Record<'all' | OrderGroup, number>;
}

export interface CheckoutResponse {
  orderNumber: string;
  accessToken: string;
  status: OrderStatus;
  payment?: RazorpayCheckoutPayload;
}

export interface RazorpayCheckoutPayload {
  provider: 'razorpay';
  keyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: 'INR';
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: unknown;
  };
}

export interface EnquiryDTO {
  id: string;
  type: EnquiryType;
  name: string;
  email?: string;
  phone?: string;
  message?: string;
  status: 'new' | 'contacted' | 'closed';
  createdAt: string;
}
