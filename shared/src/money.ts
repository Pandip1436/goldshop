/**
 * All monetary values travel through the system as integer paise (1 INR = 100 paise)
 * so that arithmetic never suffers floating-point drift.
 */

const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const inrExact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

/** Formats paise as Indian Rupees using lakh/crore grouping, e.g. 12345600 → "₹1,23,456". */
export function formatINR(paise: number, opts: { exact?: boolean } = {}): string {
  const rupees = paise / 100;
  if (opts.exact) return inrExact.format(rupees);
  // Show paise only when they are non-zero so whole-rupee prices stay clean.
  return Number.isInteger(rupees) ? inrWhole.format(rupees) : inrExact.format(rupees);
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Rounds paise to the nearest whole rupee. Jewellery prices are quoted in whole rupees. */
export function roundToRupee(paise: number): number {
  return Math.round(paise / 100) * 100;
}

/** Formats a weight stored in milligrams, e.g. 4250 → "4.25 g". */
export function formatWeight(mg: number): string {
  const g = mg / 1000;
  return `${g.toLocaleString('en-IN', { maximumFractionDigits: 3 })} g`;
}
