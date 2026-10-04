import { describe, expect, it } from "vitest";
import { rangeQuery, resolveRange } from "@/features/reports/ranges";

describe("resolveRange", () => {
  it("defaults to the whole of this month", () => {
    expect(resolveRange({}, "2026-10-03")).toEqual({ key: "this_month", from: "2026-10-01", to: "2026-10-31", label: "This month" });
    expect(resolveRange({ range: "nonsense" }, "2028-02-10")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" }); // leap year
  });

  it("handles last month across a year boundary, quarters, and year to date", () => {
    expect(resolveRange({ range: "last_month" }, "2027-01-15")).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(resolveRange({ range: "last_month" }, "2026-03-31")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveRange({ range: "this_quarter" }, "2026-10-03")).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
    expect(resolveRange({ range: "this_quarter" }, "2026-06-30")).toMatchObject({ from: "2026-04-01", to: "2026-06-30" });
    expect(resolveRange({ range: "ytd" }, "2026-10-03")).toMatchObject({ from: "2026-01-01", to: "2026-10-03" });
  });

  it("accepts a valid custom range and rejects a missing, malformed, or backwards one", () => {
    expect(resolveRange({ range: "custom", from: "2026-01-05", to: "2026-02-10" }, "2026-10-03")).toMatchObject({ key: "custom", from: "2026-01-05", to: "2026-02-10" });
    for (const bad of [{ from: "2026-02-10", to: "2026-01-05" }, { from: "2026-01-05" }, { from: "1/5/2026", to: "2026-02-10" }, { from: "2026-01-05'; drop", to: "2026-02-10" }]) {
      expect(resolveRange({ range: "custom", ...bad }, "2026-10-03").key).toBe("this_month");
    }
  });

  it("round-trips through the query string", () => {
    expect(rangeQuery(resolveRange({ range: "ytd" }, "2026-10-03"))).toBe("range=ytd");
    expect(rangeQuery(resolveRange({ range: "custom", from: "2026-01-05", to: "2026-02-10" }, "2026-10-03"))).toBe("range=custom&from=2026-01-05&to=2026-02-10");
  });
});
