import { DEFAULT_JOURNAL_SCRIPT, PURITY_KEYS, formatINR, type PublicSettings, type PurityKey, type TrustItem } from '@goldshop/shared';
import { env } from '../config/env';
import { Settings, type ISettings } from '../models';
import type { Rates } from './pricing';

let memo: { value: ISettings; at: number } | null = null;
const TTL_MS = 15_000;

/**
 * Loads the single settings document, creating it with defaults on first use.
 * Pass `fresh` for money-critical paths (checkout) so a just-updated gold rate always applies.
 */
export async function getSettings(opts: { fresh?: boolean } = {}): Promise<ISettings> {
  if (!opts.fresh && memo && Date.now() - memo.at < TTL_MS) return memo.value;
  let doc = await Settings.findOne({ key: 'store' }).lean<ISettings>();
  if (!doc) {
    await Settings.updateOne({ key: 'store' }, { $setOnInsert: { key: 'store' } }, { upsert: true });
    doc = await Settings.findOne({ key: 'store' }).lean<ISettings>();
  }
  memo = { value: doc!, at: Date.now() };
  return doc!;
}

export function invalidateSettings(): void {
  memo = null;
}

export function ratesFrom(settings: ISettings): Rates {
  const rates: Rates = {};
  for (const k of PURITY_KEYS) {
    const v = settings.goldRates?.[k];
    if (typeof v === 'number' && v > 0) rates[k] = v;
  }
  return rates;
}

/** Script words over a banner photo: one per line, blank lines dropped, at most four. */
export function scriptLines(text: string, max = 4): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, max);
}

/**
 * Fills {placeholders} in admin-written highlights from the live settings, so figures such as the
 * free-shipping threshold can never go stale. An item whose placeholder has no value is dropped.
 */
export function fillHighlights(items: TrustItem[], values: Record<string, string | undefined>): TrustItem[] {
  const fill = (text: string) => {
    let ok = true;
    const out = text.replace(/\{(\w+)\}/g, (_, key: string) => {
      const v = values[key];
      if (v === undefined) ok = false;
      return v ?? '';
    });
    return ok ? out : null;
  };
  return items.flatMap((h) => {
    if (!h.title) return [];
    const title = fill(h.title);
    const text = fill(h.text ?? '');
    return title === null || text === null ? [] : [{ ...h, title, text }];
  });
}

export function toPublicSettings(s: ISettings): PublicSettings {
  const rates = ratesFrom(s);
  const zones = (s.shipping?.zones ?? []).filter((z) => z.isActive);
  const freeThresholds = [
    ...zones.map((z) => z.freeAbove).filter((v) => v > 0),
    ...(s.shipping?.fallbackEnabled && s.shipping.fallbackFreeAbove > 0 ? [s.shipping.fallbackFreeAbove] : []),
  ];
  const allFree =
    zones.every((z) => z.rate === 0) && (!s.shipping?.fallbackEnabled || s.shipping.fallbackRate === 0);
  const address = s.store.address;
  const hasAddress = Boolean(address?.line1 && address.city);

  return {
    store: {
      name: s.store.name,
      legalName: s.store.legalName || undefined,
      tagline: s.store.tagline,
      description: s.store.description,
      email: s.store.email || undefined,
      phone: s.store.phone || undefined,
      whatsapp: s.store.whatsapp || undefined,
      address: hasAddress ? address : undefined,
      mapUrl: s.store.mapUrl || undefined,
      hours: s.store.hours || undefined,
      gstin: s.store.gstin || undefined,
      social: Object.fromEntries(Object.entries(s.store.social ?? {}).filter(([, v]) => Boolean(v))),
    },
    goldRates: { ...rates, updatedAt: s.goldRates?.updatedAt ? new Date(s.goldRates.updatedAt).toISOString() : undefined },
    displayRates: (s.displayRates ?? []).filter((k): k is PurityKey => Boolean(rates[k as PurityKey])),
    payments: {
      razorpay: env.razorpay.enabled,
      cod: {
        enabled: Boolean(s.checkout?.codEnabled),
        maxOrderValue: s.checkout?.codMaxOrderValue || undefined,
        fee: s.checkout?.codFee ?? 0,
      },
    },
    shipping: {
      freeAbove: allFree ? 0 : freeThresholds.length ? Math.min(...freeThresholds) : undefined,
      note: s.shipping?.note || undefined,
      nationwide: Boolean(s.shipping?.fallbackEnabled),
    },
    announcement: {
      enabled: Boolean(s.announcement?.enabled && s.announcement.text),
      text: s.announcement?.text ?? '',
      href: s.announcement?.href || undefined,
    },
    benefits: s.benefits ?? [],
    stats: s.stats ?? [],
    storyChapters: (s.storyChapters ?? [])
      .filter((c) => c.title)
      .map((c) => ({
        title: c.title,
        eyebrow: c.eyebrow || undefined,
        body: c.body ?? '',
        image: c.image?.key || c.image?.url ? c.image : undefined,
        features: (c.features ?? []).filter((f) => f.label).map((f) => ({ icon: f.icon || undefined, value: f.value || undefined, label: f.label })),
      })),
    about: s.about?.enabled && s.about.title
      ? {
          eyebrow: s.about.eyebrow || undefined,
          title: s.about.title,
          highlight: s.about.highlight || undefined,
          tagline: s.about.tagline || undefined,
          body: s.about.body,
          badge: s.about.badge || undefined,
          features: (s.about.features ?? []).filter((f) => f.label),
          image: s.about.image?.key || s.about.image?.url ? s.about.image : undefined,
          insetImage: s.about.insetImage?.key || s.about.insetImage?.url ? s.about.insetImage : undefined,
        }
      : undefined,
    footer: {
      highlights: fillHighlights(s.footer?.highlights ?? [], {
        // Only a real threshold: when delivery is always free there is no "over ₹…" to state.
        freeShippingAbove: !allFree && freeThresholds.length ? formatINR(Math.min(...freeThresholds)) : undefined,
        returnDays: s.checkout?.returnWindowDays ? String(s.checkout.returnWindowDays) : undefined,
      }),
      image: s.footer?.image?.key || s.footer?.image?.url ? s.footer.image : undefined,
    },
    shopPage: {
      image: s.shopPage?.image?.key || s.shopPage?.image?.url ? s.shopPage.image : undefined,
      tagline: s.shopPage?.tagline || undefined,
      features: (s.shopPage?.features ?? []).filter((f) => f.title),
    },
    collectionsPage: {
      image: s.collectionsPage?.image?.key || s.collectionsPage?.image?.url ? s.collectionsPage.image : undefined,
      subtitle: s.collectionsPage?.subtitle || undefined,
    },
    contactPage: {
      image: s.contactPage?.image?.key || s.contactPage?.image?.url ? s.contactPage.image : undefined,
      subtitle: s.contactPage?.subtitle || undefined,
      replyNote: s.contactPage?.replyNote || undefined,
      highlights: (s.contactPage?.highlights ?? []).filter((h) => h.title),
    },
    wishlistPage: { image: s.wishlistPage?.image?.key || s.wishlistPage?.image?.url ? s.wishlistPage.image : undefined },
    accountPage: { image: s.accountPage?.image?.key || s.accountPage?.image?.url ? s.accountPage.image : undefined },
    helpPage: { image: s.helpPage?.image?.key || s.helpPage?.image?.url ? s.helpPage.image : undefined },
    visitSection: { image: s.visitSection?.image?.key || s.visitSection?.image?.url ? s.visitSection.image : undefined },
    storePhotos: {
      title: s.storePhotos?.title || undefined,
      subtitle: s.storePhotos?.subtitle || undefined,
      images: (s.storePhotos?.images ?? []).filter((img) => img.key || img.url),
    },
    brand: {
      logo: s.brand?.logo?.key || s.brand?.logo?.url ? s.brand.logo : undefined,
      mark: s.brand?.mark?.key || s.brand?.mark?.url ? s.brand.mark : undefined,
    },
    homePage: {
      pricingImage: s.homePage?.pricingImage?.key || s.homePage?.pricingImage?.url ? s.homePage.pricingImage : undefined,
      savingsImage: s.homePage?.savingsImage?.key || s.homePage?.savingsImage?.url ? s.homePage.savingsImage : undefined,
      trust: (s.homePage?.trust ?? []).filter((t) => t.title),
      promos: (s.homePage?.promos ?? [])
        .filter((p) => p.title && p.href)
        .map((p) => ({
          title: p.title,
          text: p.text || undefined,
          ctaLabel: p.ctaLabel || 'Explore',
          href: p.href,
          image: p.image?.key || p.image?.url ? p.image : undefined,
        })),
    },
    journal: {
      image: s.journalPage?.image?.key || s.journalPage?.image?.url ? s.journalPage.image : undefined,
      // Documents created before this setting existed fall back to the default words.
      // up to five lines; a *word* in asterisks is set in gold
      script: scriptLines(s.journalPage?.script ?? DEFAULT_JOURNAL_SCRIPT, 5),
    },
    gstRateBps: s.tax?.gstRateBps ?? 300,
    guestCheckout: s.checkout?.guestCheckout !== false,
    savingsPlan: {
      enabled: Boolean(s.savingsPlan?.enabled),
      summary: s.savingsPlan?.summary ?? '',
      image: s.savingsPlan?.image?.key || s.savingsPlan?.image?.url ? s.savingsPlan.image : undefined,
      stepsImage: s.savingsPlan?.stepsImage?.key || s.savingsPlan?.stepsImage?.url ? s.savingsPlan.stepsImage : undefined,
      tagline: s.savingsPlan?.tagline || undefined,
      // up to five lines here: 'Save / Today / for a / Shining / Tomorrow'
      script: (s.savingsPlan?.script ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5),
      features: (s.savingsPlan?.features ?? []).filter((f) => f.title),
      schemes: (s.savingsPlan?.schemes ?? [])
        .filter((c) => c.title)
        .map((c) => ({
          title: c.title,
          eyebrow: c.eyebrow || undefined,
          points: (c.points ?? []).filter(Boolean),
          image: c.image?.key || c.image?.url ? c.image : undefined,
          details: c.details || undefined,
        })),
      highlights: (s.savingsPlan?.highlights ?? []).filter((h) => h.title),
    },
    returnWindowDays: s.checkout?.returnWindowDays || undefined,
  };
}
