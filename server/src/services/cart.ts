import { Types } from 'mongoose';
import {
  MAX_QTY_PER_LINE,
  formatINR,
  type CartDTO,
  type CartLineDTO,
  type PaymentMethod,
  type PriceBreakdown,
  type ShippingQuote,
} from '@goldshop/shared';
import { conflict, notFound } from '../lib/errors';
import { Cart, Product, type CartDoc, type ISettings } from '../models';
import { type LeanProduct, type LeanVariant } from './catalog';
import { evaluateCoupon, type CouponEvaluation } from './coupons';
import { priceVariant } from './pricing';
import { getSettings, ratesFrom } from './settings';
import { quoteShipping } from './shipping';

export interface CartOwner {
  userId?: string;
  guestToken?: string;
}

const GUEST_CART_DAYS = 30;

function ownerFilter(owner: CartOwner) {
  if (owner.userId) return { user: new Types.ObjectId(owner.userId) };
  if (owner.guestToken) return { guestToken: owner.guestToken };
  return null;
}

export async function findCart(owner: CartOwner): Promise<CartDoc | null> {
  const filter = ownerFilter(owner);
  return filter ? Cart.findOne(filter) : null;
}

export async function getOrCreateCart(owner: CartOwner): Promise<CartDoc> {
  const filter = ownerFilter(owner);
  if (!filter) throw new Error('Cart owner required');
  const expiresAt = owner.userId ? null : new Date(Date.now() + GUEST_CART_DAYS * 86400_000);
  const cart = await Cart.findOneAndUpdate(
    filter,
    { $setOnInsert: { ...filter, items: [] }, $set: { expiresAt } },
    { upsert: true, new: true },
  );
  return cart!;
}

async function loadPurchasable(productId: string, variantId: string) {
  const product = await Product.findOne({ _id: productId, isActive: true }).lean<LeanProduct>();
  const variant = product?.variants.find((v) => String(v._id) === variantId && v.isActive);
  if (!product || !variant) throw notFound('This piece is no longer available.');
  return { product, variant };
}

export async function addItem(
  owner: CartOwner,
  input: { productId: string; variantId: string; qty: number },
): Promise<{ cart: CartDoc; message?: string }> {
  const { product, variant } = await loadPurchasable(input.productId, input.variantId);
  const settings = await getSettings();
  const price = priceVariant(product, variant, ratesFrom(settings), settings.tax.gstRateBps);
  if (!price) throw conflict('This piece is priced on request. Please contact us to order it.', 'price_unavailable');
  if (variant.stock <= 0) throw conflict('Sorry, this piece is sold out.', 'out_of_stock');

  const cart = await getOrCreateCart(owner);
  const existing = cart.items.find((i) => String(i.variant) === input.variantId);
  const limit = Math.min(variant.stock, MAX_QTY_PER_LINE);
  const desired = (existing?.qty ?? 0) + input.qty;
  const qty = Math.min(desired, limit);
  let message: string | undefined;
  if (qty < desired) message = `Only ${limit} available, so we've added the maximum.`;

  if (existing) {
    existing.qty = qty;
    existing.seenPrice = price.total;
  } else {
    cart.items.push({ product: product._id, variant: variant._id, qty, seenPrice: price.total, addedAt: new Date() });
  }
  await cart.save();
  return { cart, message };
}

export async function setLineQty(owner: CartOwner, lineId: string, qty: number): Promise<CartDoc> {
  const cart = await findCart(owner);
  const line = cart?.items.id(lineId);
  if (!cart || !line) throw notFound('That item is no longer in your bag.');
  if (qty <= 0) {
    line.deleteOne();
  } else {
    const { variant } = await loadPurchasable(String(line.product), String(line.variant));
    if (variant.stock <= 0) throw conflict('Sorry, this piece is sold out.', 'out_of_stock');
    line.qty = Math.min(qty, variant.stock, MAX_QTY_PER_LINE);
  }
  await cart.save();
  return cart;
}

export async function removeLine(owner: CartOwner, lineId: string): Promise<CartDoc | null> {
  const cart = await findCart(owner);
  if (!cart) return null;
  const line = cart.items.id(lineId);
  if (line) {
    line.deleteOne();
    await cart.save();
  }
  return cart;
}

export async function setCoupon(owner: CartOwner, code: string | null): Promise<CartDoc> {
  const cart = await getOrCreateCart(owner);
  cart.couponCode = code ?? '';
  await cart.save();
  return cart;
}

/** Moves a guest cart into the signed-in customer's cart, summing quantities. */
export async function mergeGuestCart(guestToken: string, userId: string): Promise<void> {
  const guest = await Cart.findOne({ guestToken });
  if (!guest) return;
  if (guest.items.length) {
    const cart = await getOrCreateCart({ userId });
    for (const item of guest.items) {
      const existing = cart.items.find((i) => String(i.variant) === String(item.variant));
      if (existing) existing.qty = Math.min(MAX_QTY_PER_LINE, existing.qty + item.qty);
      else cart.items.push({ product: item.product, variant: item.variant, qty: item.qty, seenPrice: item.seenPrice, addedAt: item.addedAt });
    }
    if (!cart.couponCode && guest.couponCode) cart.couponCode = guest.couponCode;
    await cart.save();
  }
  await Cart.deleteOne({ _id: guest._id });
}

/** A priced, validated cart line, used both for display and for building orders. */
export interface PricedLine {
  lineId: string;
  product: LeanProduct;
  variant: LeanVariant;
  qty: number;
  price: PriceBreakdown;
  lineTotal: number;
}

export interface CartEvaluation {
  view: CartDTO;
  lines: PricedLine[];
  coupon?: CouponEvaluation;
  shipping?: ShippingQuote;
  settings: ISettings;
  /** True when anything about the cart was corrected (quantity reduced, item unavailable). */
  changed: boolean;
}

export interface EvaluateOptions {
  pincode?: string;
  state?: string;
  paymentMethod?: PaymentMethod;
  email?: string;
  phone?: string;
  userId?: string;
  /** Persist quantity corrections and acknowledge price changes. */
  persist?: boolean;
  freshSettings?: boolean;
}

/**
 * The single source of truth for what a cart costs. Prices, stock, coupon and shipping are all
 * recomputed from the database here — nothing the browser sends about money is trusted.
 */
export async function evaluateCart(cart: CartDoc | null, opts: EvaluateOptions = {}): Promise<CartEvaluation> {
  const settings = await getSettings({ fresh: opts.freshSettings });
  const rates = ratesFrom(settings);
  const gstBps = settings.tax?.gstRateBps ?? 300;
  const items = cart?.items ?? [];

  const products = items.length
    ? await Product.find({ _id: { $in: items.map((i) => i.product) } }).lean<LeanProduct[]>()
    : [];
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const viewLines: CartLineDTO[] = [];
  const priced: PricedLine[] = [];
  const issues: string[] = [];
  let changed = false;
  let dirty = false;

  for (const item of items) {
    const product = byId.get(String(item.product));
    const variant = product?.variants.find((v) => String(v._id) === String(item.variant));
    const base: Omit<CartLineDTO, 'unitPrice' | 'lineTotal' | 'maxQty'> = {
      id: String(item._id),
      productId: String(item.product),
      variantId: String(item.variant),
      slug: product?.slug ?? '',
      name: product?.name ?? 'Unavailable item',
      variantLabel: variant && product && product.variants.filter((v) => v.isActive).length > 1 ? variant.label : '',
      image: product?.images?.[0]?.key || product?.images?.[0]?.url ? product.images[0] : undefined,
      purity: product?.purity ?? undefined,
      netWeightMg: variant?.netWeightMg || undefined,
      qty: item.qty,
    };

    const price = product && variant ? priceVariant(product, variant, rates, gstBps) : null;
    if (!product || !product.isActive || !variant || !variant.isActive || !price) {
      viewLines.push({ ...base, unitPrice: 0, lineTotal: 0, maxQty: 0, unavailable: true, issue: 'This piece is no longer available.' });
      changed = true;
      continue;
    }
    if (variant.stock <= 0) {
      viewLines.push({ ...base, unitPrice: price.total, lineTotal: 0, maxQty: 0, unavailable: true, issue: 'Sold out' });
      changed = true;
      continue;
    }

    const maxQty = Math.min(variant.stock, MAX_QTY_PER_LINE);
    let qty = item.qty;
    let issue: string | undefined;
    if (qty > maxQty) {
      qty = maxQty;
      issue = `Only ${maxQty} available — quantity updated.`;
      changed = true;
      if (opts.persist) {
        item.qty = qty;
        dirty = true;
      }
    }
    if (item.seenPrice && item.seenPrice !== price.total) {
      const direction = price.total > item.seenPrice ? 'up' : 'down';
      issue ??= `Price ${direction === 'up' ? 'increased' : 'dropped'} from ${formatINR(item.seenPrice)} with today's rate.`;
      if (opts.persist) {
        item.seenPrice = price.total;
        dirty = true;
      }
    }

    const lineTotal = price.total * qty;
    viewLines.push({ ...base, qty, unitPrice: price.total, lineTotal, maxQty, issue });
    priced.push({ lineId: String(item._id), product, variant, qty, price, lineTotal });
  }

  if (dirty && cart) await cart.save();

  const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const makingTotal = priced.reduce((s, l) => s + (l.price.making - l.price.makingDiscount) * l.qty, 0);

  let coupon: CouponEvaluation | undefined;
  if (cart?.couponCode && priced.length) {
    coupon = await evaluateCoupon(cart.couponCode, {
      subtotal,
      makingTotal,
      email: opts.email,
      phone: opts.phone,
      userId: opts.userId,
    });
  }
  const discount = coupon?.valid ? coupon.discount : 0;

  let shipping: ShippingQuote | undefined;
  if (opts.pincode && priced.length) {
    shipping = quoteShipping(settings, opts.pincode, subtotal - discount, opts.state);
  }

  let codFee = 0;
  if (opts.paymentMethod === 'cod' && settings.checkout?.codEnabled) codFee = settings.checkout.codFee ?? 0;

  const total = Math.max(0, subtotal - discount + (shipping?.serviceable ? shipping.amount : 0) + codFee);
  const gstIncluded = total - Math.round((total * 10000) / (10000 + gstBps));

  if (viewLines.some((l) => l.unavailable)) issues.push('Some items in your bag are unavailable. Remove them to continue.');

  const view: CartDTO = {
    lines: viewLines,
    itemCount: priced.reduce((s, l) => s + l.qty, 0),
    subtotal,
    coupon: coupon
      ? { code: coupon.code, valid: coupon.valid, discount: coupon.discount, description: coupon.description, message: coupon.message }
      : undefined,
    discount,
    shipping,
    codFee,
    total,
    gstIncluded,
    issues,
    goldRatesUpdatedAt: settings.goldRates?.updatedAt ? new Date(settings.goldRates.updatedAt).toISOString() : undefined,
  };

  return { view, lines: priced, coupon, shipping, settings, changed };
}

/** Removes purchased variants from the cart that placed an order, leaving anything added since. */
export async function removePurchasedFromCart(
  owner: CartOwner,
  purchased: { variant: Types.ObjectId; qty: number }[],
): Promise<void> {
  const cart = await findCart(owner);
  if (!cart) return;
  for (const p of purchased) {
    const line = cart.items.find((i) => String(i.variant) === String(p.variant));
    if (!line) continue;
    if (line.qty <= p.qty) line.deleteOne();
    else line.qty -= p.qty;
  }
  cart.couponCode = '';
  await cart.save();
}
