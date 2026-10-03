const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$24,800" (or "$24,800.50" when there are cents). Money is stored as integer cents. */
export function formatCents(cents: number | null | undefined, options: { alwaysCents?: boolean } = {}): string {
  if (cents === null || cents === undefined) return "—";
  return options.alwaysCents || cents % 100 !== 0 ? exact.format(cents / 100) : whole.format(cents / 100);
}

/** Parses "24,800", "$24,800.50", "1200.5" into cents. Returns null for empty or invalid input. */
export function parseDollarsToCents(input: string | null | undefined): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [dollars, cents = ""] = cleaned.split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}
