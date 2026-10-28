/** States and union territories of India, used for address forms, GST place-of-supply and shipping zones. */
export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

export type IndianState = (typeof INDIAN_STATES)[number];

/** Indian PIN codes are six digits and never start with 0. */
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

/** Indian mobile numbers: 10 digits starting 6–9 (after stripping +91 / 0 prefixes). */
export const MOBILE_REGEX = /^[6-9][0-9]{9}$/;

/** GSTIN: 2-digit state code, 10-char PAN, entity number, 'Z', checksum. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Strips spaces, dashes, and a leading +91 / 91 / 0 so numbers compare consistently. */
export function normalizeIndianMobile(input: string): string {
  let digits = input.replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

export function isValidIndianMobile(input: string): boolean {
  return MOBILE_REGEX.test(normalizeIndianMobile(input));
}

/** Formats a 10-digit mobile as "+91 98765 43210". */
export function formatIndianMobile(input: string): string {
  const d = normalizeIndianMobile(input);
  if (d.length !== 10) return input;
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

/** wa.me expects the number with country code and no punctuation. */
export function whatsappLink(mobile: string, text?: string): string {
  const d = normalizeIndianMobile(mobile);
  const base = `https://wa.me/91${d}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
