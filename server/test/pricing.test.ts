import { describe, expect, it } from 'vitest';
import { priceVariant, splitGst } from '../src/services/pricing';
import { computeCouponDiscount } from '../src/services/coupons';
import { resolveZone, quoteShipping } from '../src/services/shipping';
import type { ISettings } from '../src/models';

const rates = { gold22: 1_173_000, gold18: 960_000 }; // ₹11,730/g and ₹9,600/g, in paise

describe('priceVariant (weight-based)', () => {
  it('prices gold value + percentage making + GST, every component in whole rupees', () => {
    const p = priceVariant(
      { pricingMode: 'weight', purity: 'gold22', making: { type: 'percent', value: 12 }, makingDiscountPercent: 0 },
      { netWeightMg: 4_250 },
      rates,
      300,
    )!;
    // 4.25 g × ₹11,730 = ₹49,852.50 → ₹49,853 (rounded to the rupee)
    expect(p.metalValue).toBe(4_985_300);
    // 12% of ₹49,853 = ₹5,982.36 → ₹5,982
    expect(p.making).toBe(598_200);
    expect(p.taxable).toBe(4_985_300 + 598_200);
    // 3% GST of ₹55,835 = ₹1,675.05 → ₹1,675
    expect(p.gst).toBe(167_500);
    expect(p.total).toBe(p.taxable + p.gst);
    expect(p.total % 100).toBe(0);
  });

  it('applies per-gram making charges, making discounts and stone charges', () => {
    const p = priceVariant(
      { pricingMode: 'weight', purity: 'gold18', making: { type: 'per_gram', value: 80_000 }, makingDiscountPercent: 25 },
      { netWeightMg: 2_000, stoneCharge: 350_000 },
      rates,
      300,
    )!;
    expect(p.metalValue).toBe(1_920_000); // 2 g × ₹9,600
    expect(p.making).toBe(160_000); // 2 g × ₹800
    expect(p.makingDiscount).toBe(40_000); // 25% of ₹1,600
    expect(p.stone).toBe(350_000);
    expect(p.taxable).toBe(1_920_000 + 160_000 - 40_000 + 350_000);
    expect(p.total).toBe(p.taxable + p.gst);
  });

  it('supports flat making charges', () => {
    const p = priceVariant(
      { pricingMode: 'weight', purity: 'gold22', making: { type: 'flat', value: 150_000 } },
      { netWeightMg: 1_000 },
      rates,
      300,
    )!;
    expect(p.making).toBe(150_000);
  });

  it('returns null when the purity has no rate, so the item cannot be sold at a wrong price', () => {
    expect(priceVariant({ pricingMode: 'weight', purity: 'gold24', making: null }, { netWeightMg: 1000 }, rates, 300)).toBeNull();
    expect(priceVariant({ pricingMode: 'weight', purity: 'gold22', making: null }, { netWeightMg: 0 }, rates, 300)).toBeNull();
  });
});

describe('priceVariant (fixed price)', () => {
  it('treats the stored price as GST-inclusive and derives the tax component', () => {
    const p = priceVariant({ pricingMode: 'fixed' }, { fixedPrice: 103_000 }, rates, 300)!;
    expect(p.total).toBe(103_000);
    expect(p.taxable).toBe(100_000);
    expect(p.gst).toBe(3_000);
  });
});

describe('splitGst', () => {
  it('splits into CGST + SGST for intra-state supply', () => {
    const g = splitGst(1_030_000, 300, 'Tamil Nadu', 'Tamil Nadu');
    expect(g.taxableValue).toBe(1_000_000);
    expect(g.cgst + g.sgst).toBe(30_000);
    expect(g.igst).toBe(0);
  });
  it('uses IGST for inter-state supply', () => {
    const g = splitGst(1_030_000, 300, 'Tamil Nadu', 'Karnataka');
    expect(g.igst).toBe(30_000);
    expect(g.cgst).toBe(0);
  });
});

describe('computeCouponDiscount', () => {
  it('caps percentage discounts at maxDiscount and rounds down to the rupee', () => {
    expect(computeCouponDiscount({ type: 'percent', value: 10, scope: 'order', maxDiscount: 200_000 }, 5_000_000, 0)).toBe(200_000);
    expect(computeCouponDiscount({ type: 'percent', value: 7, scope: 'order', maxDiscount: 0 }, 123_456, 0)).toBe(8_600);
  });
  it('never discounts more than the subtotal', () => {
    expect(computeCouponDiscount({ type: 'flat', value: 900_000, scope: 'order', maxDiscount: 0 }, 500_000, 0)).toBe(500_000);
  });
  it('limits making-charge coupons to the making charges in the cart', () => {
    expect(computeCouponDiscount({ type: 'percent', value: 50, scope: 'making', maxDiscount: 0 }, 5_000_000, 600_000)).toBe(300_000);
    expect(computeCouponDiscount({ type: 'percent', value: 50, scope: 'making', maxDiscount: 0 }, 5_000_000, 0)).toBe(0);
  });
});

describe('shipping zones', () => {
  const settings = {
    checkout: { codEnabled: true },
    shipping: {
      zones: [
        { name: 'Chennai city', states: [], pinPrefixes: ['600'], rate: 0, freeAbove: 0, codAvailable: true, etaMinDays: 1, etaMaxDays: 2, isActive: true },
        { name: 'Tamil Nadu', states: ['Tamil Nadu'], pinPrefixes: ['6'], rate: 10_000, freeAbove: 1_000_000, codAvailable: true, etaMinDays: 2, etaMaxDays: 4, isActive: true },
        { name: 'Kerala', states: ['Kerala'], pinPrefixes: [], rate: 20_000, freeAbove: 0, codAvailable: false, etaMinDays: 3, etaMaxDays: 5, isActive: true },
      ],
      fallbackEnabled: false,
    },
  } as unknown as ISettings;

  it('prefers the longest matching PIN prefix', () => {
    expect(resolveZone(settings, '600004')?.name).toBe('Chennai city');
    expect(resolveZone(settings, '641001')?.name).toBe('Tamil Nadu');
  });
  it('falls back to the state when no prefix matches', () => {
    expect(resolveZone(settings, '682001', 'Kerala')?.name).toBe('Tamil Nadu'); // '6' prefix still wins
    expect(resolveZone(settings, '595001', 'Kerala')?.name).toBe('Kerala');
  });
  it('reports unserviceable destinations when there is no fallback', () => {
    const q = quoteShipping(settings, '110001', 500_000, 'Delhi');
    expect(q.serviceable).toBe(false);
  });
  it('waives the charge above the free-shipping threshold', () => {
    expect(quoteShipping(settings, '641001', 999_900).amount).toBe(10_000);
    expect(quoteShipping(settings, '641001', 1_000_000).amount).toBe(0);
  });
});
