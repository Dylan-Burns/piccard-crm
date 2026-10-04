/** Date ranges for the dashboard and reports. All dates are yyyy-MM-dd days in the company timezone. */
export const RANGE_PRESETS = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom" },
] as const;
export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];
export type ResolvedRange = { key: RangeKey; from: string; to: string; label: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");
const day = (year: number, month: number, date: number) => `${year}-${pad(month)}-${pad(date)}`;
/** Last day of a month (month is 1 to 12). */
const lastOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Turns the query string into a concrete range. `today` is the company's current day. Presets run
 * to the end of their period, so "This month" on the 3rd still covers the whole month. Anything
 * unrecognized, or a custom range that is missing or backwards, falls back to This month.
 */
export function resolveRange(input: { range?: string; from?: string; to?: string }, today: string): ResolvedRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const thisMonth: ResolvedRange = { key: "this_month", from: day(year, month, 1), to: day(year, month, lastOf(year, month)), label: "This month" };

  switch (input.range) {
    case "last_month": {
      const y = month === 1 ? year - 1 : year;
      const m = month === 1 ? 12 : month - 1;
      return { key: "last_month", from: day(y, m, 1), to: day(y, m, lastOf(y, m)), label: "Last month" };
    }
    case "this_quarter": {
      const start = month - ((month - 1) % 3);
      return { key: "this_quarter", from: day(year, start, 1), to: day(year, start + 2, lastOf(year, start + 2)), label: "This quarter" };
    }
    case "ytd":
      return { key: "ytd", from: day(year, 1, 1), to: today, label: "Year to date" };
    case "custom":
      if (input.from && input.to && DAY.test(input.from) && DAY.test(input.to) && input.from <= input.to) {
        return { key: "custom", from: input.from, to: input.to, label: `${input.from} to ${input.to}` };
      }
      return thisMonth;
    default:
      return thisMonth;
  }
}

/** Query string that reproduces a range (for links and CSV downloads). */
export function rangeQuery(range: ResolvedRange): string {
  return range.key === "custom" ? `range=custom&from=${range.from}&to=${range.to}` : `range=${range.key}`;
}
