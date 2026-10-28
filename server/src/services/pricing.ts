import { roundToRupee, type PriceBreakdown, type PurityKey, type MakingChargeType, type PricingMode } from '@goldshop/shared';

/** Per-gram metal rates in paise, keyed by purity. */
export type Rates = Partial<Record<PurityKey, number>>;

export interface PricedProductFields {
  pricingMode: PricingMode;
  purity?: PurityKey | null;
  making?: { type: MakingChargeType; value: number } | null;
  makingDiscountPercent?: number | null;
}

export interface PricedVariantFields {
  netWeightMg?: number | null;
  stoneCharge?: number | null;
  fixedPrice?: number | null;
}

/**
 * Computes the price of one unit of a variant.
 *
 * Weight-priced pieces:  metal value (net weight × today's rate) + making − making discount + stones,
 * then GST on top. Every component is rounded to the rupee so the breakdown always adds up exactly.
 *
 * Fixed-price pieces: the stored price already includes GST; the tax component is derived from it.
 *
 * Returns null when the piece cannot be priced (e.g. no rate set for its purity) — such items
 * are shown as "price on request" and cannot be added to the cart.
 */
export function priceVariant(
  product: PricedProductFields,
  variant: PricedVariantFields,
  rates: Rates,
  gstRateBps: number,
): PriceBreakdown | null {
  if (product.pricingMode === 'fixed') {
    const total = Math.max(0, Math.round(variant.fixedPrice ?? 0));
    if (total <= 0) return null;
    const taxable = Math.round((total * 10000) / (10000 + gstRateBps));
    return {
      mode: 'fixed',
      metalValue: 0,
      making: 0,
      makingDiscount: 0,
      stone: 0,
      taxable,
      gst: total - taxable,
      total,
    };
  }

  const purity = product.purity ?? undefined;
  const rate = purity ? rates[purity] ?? 0 : 0;
  const netMg = Math.max(0, Math.round(variant.netWeightMg ?? 0));
  if (!purity || rate <= 0 || netMg <= 0) return null;

  const metalValue = roundToRupee((netMg * rate) / 1000);
  const making = roundToRupee(makingCharge(product.making, netMg, metalValue));
  const discountPct = clamp(product.makingDiscountPercent ?? 0, 0, 100);
  const makingDiscount = roundToRupee((making * discountPct) / 100);
  const stone = roundToRupee(Math.max(0, variant.stoneCharge ?? 0));
  const taxable = metalValue + making - makingDiscount + stone;
  const gst = roundToRupee((taxable * gstRateBps) / 10000);

  return {
    mode: 'weight',
    metalValue,
    making,
    makingDiscount,
    stone,
    taxable,
    gst,
    total: taxable + gst,
    ratePerGram: rate,
    purity,
    netWeightMg: netMg,
  };
}

function makingCharge(
  making: PricedProductFields['making'],
  netMg: number,
  metalValue: number,
): number {
  if (!making || making.value <= 0) return 0;
  switch (making.type) {
    case 'percent':
      return (metalValue * making.value) / 100;
    case 'per_gram':
      // value is paise per gram
      return (netMg * making.value) / 1000;
    case 'flat':
      return making.value;
    default:
      return 0;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Splits an order's GST-inclusive total into taxable value and tax, and into CGST+SGST
 * (intra-state supply) or IGST (inter-state supply) based on the place of supply.
 */
export function splitGst(totalInclusive: number, gstRateBps: number, storeState: string, deliveryState: string) {
  const taxableValue = Math.round((totalInclusive * 10000) / (10000 + gstRateBps));
  const gstAmount = totalInclusive - taxableValue;
  const intraState = Boolean(storeState) && storeState === deliveryState;
  const cgst = intraState ? Math.floor(gstAmount / 2) : 0;
  const sgst = intraState ? gstAmount - cgst : 0;
  const igst = intraState ? 0 : gstAmount;
  return { taxableValue, gstAmount, cgst, sgst, igst };
}
