/**
 * Estimate math (spec §7.2). This is a PREVIEW of what the database trigger
 * `private.recalc_estimate` stores; the stored numbers are the truth. The fixtures in
 * `totals.fixtures.ts` are run through both, and the tests assert they agree.
 *
 * All money is integer cents. Rounding is half away from zero, matching Postgres `round(numeric)`.
 */
export type TotalsLine = { quantity: number; unitPriceCents: number; isTaxable: boolean };
export type TotalsInput = { lines: TotalsLine[]; discountCents: number; taxRate: number; depositPercent: number };
export type Totals = { subtotalCents: number; discountCents: number; taxableCents: number; taxCents: number; totalCents: number; depositCents: number };

/**
 * round(numerator / denominator) for non-negative integers, half up, without floating point.
 * BigInt keeps products such as cents × rate exact.
 */
function divRound(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

/** Quantity has two decimals and the rate five; both are carried as scaled integers. */
const scaled = (value: number, digits: number) => BigInt(Math.round(value * 10 ** digits));

/** Line total: round(quantity × unit price), as the generated column computes it. */
export function lineTotalCents(line: Pick<TotalsLine, "quantity" | "unitPriceCents">): number {
  return divRound(scaled(line.quantity, 2) * BigInt(line.unitPriceCents), 100n);
}

export function computeTotals(input: TotalsInput): Totals {
  let subtotal = 0;
  let taxable = 0;
  for (const line of input.lines) {
    const total = lineTotalCents(line);
    subtotal += total;
    if (line.isTaxable) taxable += total;
  }
  const discount = Math.min(Math.max(0, Math.trunc(input.discountCents)), subtotal);
  // The discount is spread over taxable and non-taxable lines in proportion.
  const taxableDiscount = subtotal === 0 ? 0 : divRound(BigInt(discount) * BigInt(taxable), BigInt(subtotal));
  const taxableAfter = taxable - taxableDiscount;
  const tax = divRound(BigInt(taxableAfter) * scaled(input.taxRate, 5), 100_000n);
  const total = subtotal - discount + tax;
  const deposit = divRound(BigInt(total) * BigInt(Math.trunc(input.depositPercent)), 100n);
  return { subtotalCents: subtotal, discountCents: discount, taxableCents: taxable, taxCents: tax, totalCents: total, depositCents: deposit };
}
