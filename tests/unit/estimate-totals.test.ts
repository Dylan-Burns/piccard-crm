import { describe, expect, it } from "vitest";
import { computeTotals, lineTotalCents } from "@/features/estimates/totals";
import { TOTALS_FIXTURES } from "@/features/estimates/totals.fixtures";

describe("estimate totals (TypeScript preview)", () => {
  it("rounds a line total half up", () => {
    expect(lineTotalCents({ quantity: 0.5, unitPriceCents: 333 })).toBe(167); // 166.5
    expect(lineTotalCents({ quantity: 1.25, unitPriceCents: 999 })).toBe(1249); // 1248.75
    expect(lineTotalCents({ quantity: 28.5, unitPriceCents: 42_500 })).toBe(1_211_250);
  });

  it("works the five-line fixture by hand", () => {
    // lines: 1,211,250 + 78,000 + 85,000 + 46,875 + 38,997 = 1,460,122; taxable = 1,328,247
    // discount 50,000 → taxable share round(50,000 × 1,328,247 / 1,460,122) = 45,484
    // tax = round((1,328,247 − 45,484) × 0.0825) = round(105,827.9475) = 105,828
    // total = 1,460,122 − 50,000 + 105,828 = 1,515,950; deposit 30% = round(454,785) = 454,785
    const fixture = TOTALS_FIXTURES.find((f) => f.name.startsWith("five lines"))!;
    expect(computeTotals(fixture.input)).toEqual({ subtotalCents: 1_460_122, discountCents: 50_000, taxableCents: 1_328_247, taxCents: 105_828, totalCents: 1_515_950, depositCents: 454_785 });
  });

  it.each(TOTALS_FIXTURES.filter((f) => f.expected))("$name", ({ input, expected }) => {
    expect(computeTotals(input)).toMatchObject(expected!);
  });

  it("never produces fractions or negative amounts", () => {
    for (const { input } of TOTALS_FIXTURES) {
      for (const value of Object.values(computeTotals(input))) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
