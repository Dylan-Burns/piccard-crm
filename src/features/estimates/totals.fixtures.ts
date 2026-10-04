import type { TotalsInput } from "@/features/estimates/totals";

/**
 * Shared by the unit test (TypeScript) and the integration test (database trigger): both must
 * produce the same numbers for every fixture. `expected` is included where it was worked by hand.
 */
export const TOTALS_FIXTURES: { name: string; input: TotalsInput; expected?: { subtotalCents: number; taxCents: number; totalCents: number; depositCents: number } }[] = [
  {
    name: "empty estimate",
    input: { lines: [], discountCents: 0, taxRate: 0, depositPercent: 30 },
    expected: { subtotalCents: 0, taxCents: 0, totalCents: 0, depositCents: 0 },
  },
  {
    name: "one line, no tax (the default settings)",
    input: { lines: [{ quantity: 24, unitPriceCents: 45_000, isTaxable: true }], discountCents: 0, taxRate: 0, depositPercent: 30 },
    expected: { subtotalCents: 1_080_000, taxCents: 0, totalCents: 1_080_000, depositCents: 324_000 },
  },
  {
    name: "five lines, mixed taxable, discount, 8.25% tax",
    input: {
      lines: [
        { quantity: 28.5, unitPriceCents: 42_500, isTaxable: true },
        { quantity: 120, unitPriceCents: 650, isTaxable: true },
        { quantity: 1, unitPriceCents: 85_000, isTaxable: false },
        { quantity: 6.25, unitPriceCents: 7_500, isTaxable: false },
        { quantity: 3, unitPriceCents: 12_999, isTaxable: true },
      ],
      discountCents: 50_000,
      taxRate: 0.0825,
      depositPercent: 30,
    },
  },
  {
    name: "fractional quantity that rounds a half cent",
    input: { lines: [{ quantity: 0.5, unitPriceCents: 333, isTaxable: true }, { quantity: 1.25, unitPriceCents: 999, isTaxable: true }], discountCents: 0, taxRate: 0.07, depositPercent: 50 },
  },
  {
    name: "discount larger than the subtotal is capped",
    input: { lines: [{ quantity: 2, unitPriceCents: 10_000, isTaxable: true }], discountCents: 99_999, taxRate: 0.06, depositPercent: 25 },
    expected: { subtotalCents: 20_000, taxCents: 0, totalCents: 0, depositCents: 0 },
  },
  {
    name: "discount with only non-taxable lines",
    input: { lines: [{ quantity: 10, unitPriceCents: 12_345, isTaxable: false }], discountCents: 1_000, taxRate: 0.0825, depositPercent: 33 },
  },
  {
    name: "five-decimal tax rate and a deposit that rounds",
    input: { lines: [{ quantity: 17.33, unitPriceCents: 38_995, isTaxable: true }, { quantity: 2, unitPriceCents: 4_501, isTaxable: false }], discountCents: 12_345, taxRate: 0.08875, depositPercent: 33 },
  },
  {
    name: "large job",
    input: { lines: [{ quantity: 310.75, unitPriceCents: 61_250, isTaxable: true }, { quantity: 1, unitPriceCents: 1_250_000, isTaxable: true }], discountCents: 250_000, taxRate: 0.0625, depositPercent: 10 },
  },
];
