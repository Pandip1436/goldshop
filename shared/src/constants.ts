/** Metal purities the store can price. Keys are stable identifiers stored in the database. */
export const PURITIES = {
  gold24: { label: '24K', metal: 'gold', fineness: 999, name: '24 Karat Gold' },
  gold22: { label: '22K', metal: 'gold', fineness: 916, name: '22 Karat Gold' },
  gold18: { label: '18K', metal: 'gold', fineness: 750, name: '18 Karat Gold' },
  gold14: { label: '14K', metal: 'gold', fineness: 585, name: '14 Karat Gold' },
  silver999: { label: 'Fine Silver', metal: 'silver', fineness: 999, name: 'Fine Silver (999)' },
  silver925: { label: 'Sterling Silver', metal: 'silver', fineness: 925, name: 'Sterling Silver (925)' },
} as const;

export type PurityKey = keyof typeof PURITIES;
export const PURITY_KEYS = Object.keys(PURITIES) as PurityKey[];

export const MAKING_CHARGE_TYPES = ['percent', 'per_gram', 'flat'] as const;
export type MakingChargeType = (typeof MAKING_CHARGE_TYPES)[number];

export const PRICING_MODES = ['weight', 'fixed'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export const ORDER_STATUSES = [
  'pending_payment',
  'confirmed',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'payment_review',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  confirmed: 'Confirmed',
  processing: 'Being prepared',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
  payment_review: 'Payment under review',
};

/** How a customer's orders are grouped in their account. */
export const ORDER_GROUPS = {
  processing: ['pending_payment', 'payment_review', 'confirmed', 'processing'],
  shipped: ['shipped', 'out_for_delivery'],
  delivered: ['delivered'],
  cancelled: ['cancelled', 'returned'],
} as const satisfies Record<string, readonly OrderStatus[]>;
export type OrderGroup = keyof typeof ORDER_GROUPS;

/** The forward path an order normally travels; used for progress steppers. */
export const ORDER_PROGRESS: OrderStatus[] = ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

/** Which manual status changes the admin may make from each status. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['cancelled'],
  payment_review: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered', 'returned'],
  out_for_delivery: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

export const PAYMENT_METHODS = ['razorpay', 'cod'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
};

export const ROLES = ['customer', 'staff', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ENQUIRY_TYPES = ['contact', 'savings_plan', 'product', 'custom_order', 'newsletter'] as const;
export type EnquiryType = (typeof ENQUIRY_TYPES)[number];

export const ENQUIRY_TYPE_LABELS: Record<EnquiryType, string> = {
  contact: 'General enquiry',
  savings_plan: 'Gold savings plan',
  product: 'Product enquiry',
  custom_order: 'Custom design',
  newsletter: 'Newsletter sign-up',
};

/** What a contact-form message is about, so the right person picks it up. */
export const ENQUIRY_TOPICS = ['product', 'sizing', 'custom', 'order', 'returns', 'pricing', 'savings', 'other'] as const;
export type EnquiryTopic = (typeof ENQUIRY_TOPICS)[number];
export const ENQUIRY_TOPIC_LABELS: Record<EnquiryTopic, string> = {
  product: 'A piece I’ve seen',
  sizing: 'Sizing and fit',
  custom: 'Custom or made-to-order work',
  order: 'An order I’ve placed',
  returns: 'Returns and refunds',
  pricing: 'Prices and the gold rate',
  savings: 'Gold savings plan',
  other: 'Something else',
};

export const PRODUCT_SORTS = ['featured', 'popular', 'newest', 'price_asc', 'price_desc', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const PRODUCT_SORT_LABELS: Record<ProductSort, string> = {
  featured: 'Featured',
  popular: 'Best selling',
  newest: 'Newest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  rating: 'Top rated',
};

export const MAX_QTY_PER_LINE = 10;
export const PAGE_SIZE_DEFAULT = 24;
export const PAGE_SIZE_MAX = 48;

/** Policy pages every Indian e-commerce store should publish. */
export const POLICY_SLUGS = ['shipping-policy', 'returns-and-refunds', 'cancellation-policy', 'privacy-policy', 'terms'] as const;

/** The journal banner's script words until an admin changes them (one line each). */
export const DEFAULT_JOURNAL_SCRIPT = 'Knowledge\nMakes\nEvery Piece\nMore Special';
