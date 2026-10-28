import { INDIAN_STATES, PINCODE_REGEX, type ShippingQuote } from '@goldshop/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import type { ISettings } from '../models';

interface ResolvedZone {
  name: string;
  rate: number;
  freeAbove: number;
  codAvailable: boolean;
  etaMinDays: number;
  etaMaxDays: number;
}

/**
 * Finds the shipping zone for a destination. PIN-prefix zones are the most specific and win
 * (longest prefix first), then state zones, then the optional "rest of India" fallback.
 */
export function resolveZone(settings: ISettings, pincode: string, state?: string): ResolvedZone | null {
  const zones = (settings.shipping?.zones ?? []).filter((z) => z.isActive);

  let best: { zone: (typeof zones)[number]; len: number } | null = null;
  for (const z of zones) {
    for (const prefix of z.pinPrefixes ?? []) {
      if (pincode.startsWith(prefix) && (!best || prefix.length > best.len)) best = { zone: z, len: prefix.length };
    }
  }
  const byState = !best && state ? zones.find((z) => (z.states ?? []).includes(state)) : undefined;
  const zone = best?.zone ?? byState;
  if (zone) {
    return {
      name: zone.name,
      rate: zone.rate,
      freeAbove: zone.freeAbove,
      codAvailable: zone.codAvailable,
      etaMinDays: zone.etaMinDays,
      etaMaxDays: zone.etaMaxDays,
    };
  }
  const s = settings.shipping;
  if (s?.fallbackEnabled) {
    return {
      name: 'Rest of India',
      rate: s.fallbackRate,
      freeAbove: s.fallbackFreeAbove,
      codAvailable: s.fallbackCod,
      etaMinDays: s.fallbackEtaMin,
      etaMaxDays: s.fallbackEtaMax,
    };
  }
  return null;
}

export function quoteShipping(
  settings: ISettings,
  pincode: string,
  subtotalAfterDiscount: number,
  state?: string,
): ShippingQuote {
  if (!PINCODE_REGEX.test(pincode)) {
    return { serviceable: false, pincode, amount: 0, codAvailable: false, message: 'Enter a valid 6-digit PIN code.' };
  }
  const zone = resolveZone(settings, pincode, state);
  if (!zone) {
    return {
      serviceable: false,
      pincode,
      amount: 0,
      codAvailable: false,
      message: "Sorry, we don't deliver to this PIN code yet. Contact us and we'll try to help.",
    };
  }
  const free = zone.rate === 0 || (zone.freeAbove > 0 && subtotalAfterDiscount >= zone.freeAbove);
  const codAllowedBySettings = Boolean(settings.checkout?.codEnabled);
  return {
    serviceable: true,
    pincode,
    zoneName: zone.name,
    amount: free ? 0 : zone.rate,
    freeAbove: zone.freeAbove || undefined,
    etaMinDays: zone.etaMinDays,
    etaMaxDays: zone.etaMaxDays,
    codAvailable: codAllowedBySettings && zone.codAvailable,
  };
}

/* ---------- Optional PIN → city/state lookup (India Post public API) ---------- */

const lookupCache = new Map<string, { city?: string; state?: string; at: number }>();
const LOOKUP_TTL = 24 * 60 * 60 * 1000;

function canonicalState(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase().replace(/&/g, 'and');
  return INDIAN_STATES.find((s) => s.toLowerCase() === n);
}

/** Returns city/state for a PIN when PINCODE_LOOKUP is enabled. Failures are silent: the customer types it instead. */
export async function lookupPincode(pincode: string): Promise<{ city?: string; state?: string }> {
  if (!env.pincodeLookup || !PINCODE_REGEX.test(pincode)) return {};
  const hit = lookupCache.get(pincode);
  if (hit && Date.now() - hit.at < LOOKUP_TTL) return { city: hit.city, state: hit.state };
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return {};
    const body = (await res.json()) as Array<{ Status: string; PostOffice?: Array<{ District?: string; State?: string }> }>;
    const office = body?.[0]?.Status === 'Success' ? body[0].PostOffice?.[0] : undefined;
    const result = { city: office?.District, state: canonicalState(office?.State) };
    if (lookupCache.size > 5000) lookupCache.clear();
    lookupCache.set(pincode, { ...result, at: Date.now() });
    return result;
  } catch (err) {
    logger.debug({ err, pincode }, 'PIN lookup failed');
    return {};
  }
}
