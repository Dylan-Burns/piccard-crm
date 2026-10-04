import { describe, expect, it } from "vitest";
import { reportTable, toCsv } from "@/features/reports/csv";
import type { Reports } from "@/features/reports/queries";

const reports: Reports = {
  bySource: [{ source: 'Referral, "word of mouth"', leads: 4, won: 2, lost: 1, open: 1, cohort_conversion: 0.5, sold_cents: 1_500_000 }],
  byStage: [{ stage: "inspection_scheduled", deals: 3, value_cents: 4_250_050, avg_days_in_stage: 2.5 }],
  byMonth: [{ month: "2026-09-01", won_count: 2, sold_cents: 3_000_000 }],
  reps: [{ owner_id: "x", owner_name: "Sam Sales", leads_assigned: 3, won: 2, lost: 1, close_rate: 0.6667, sold_cents: 1_500_000, avg_days_to_close: 18.3, median_minutes_to_first_attempt: null as never, overdue_tasks: 0 }],
  lost: [{ reason: "price", deals: 1, value_cents: 300_000 }],
};

describe("report tables and CSV", () => {
  it("formats money as dollars, rates as percentages, and labels stages and reasons", () => {
    expect(reportTable("leads-by-source", reports).rows).toEqual([['Referral, "word of mouth"', "4", "2", "1", "1", "50.0", "15000.00"]]);
    expect(reportTable("pipeline-by-stage", reports).rows).toEqual([["Inspection Scheduled", "3", "42500.50", "2.5"]]);
    expect(reportTable("revenue-by-month", reports).rows).toEqual([["2026-09", "2", "30000.00"]]);
    expect(reportTable("rep-performance", reports).rows[0]).toEqual(["Sam Sales", "3", "2", "1", "66.7", "15000.00", "18.3", "", "0"]);
    expect(reportTable("lost-reasons", reports).rows).toEqual([["Price", "1", "3000.00"]]);
  });

  it("quotes cells with commas or quotes and defuses spreadsheet formulas", () => {
    const table = reportTable("leads-by-source", reports);
    expect(toCsv(table.headers, table.rows)).toBe('Source,Leads,Won,Lost,Open,Conversion %,Sold ($)\r\n"Referral, ""word of mouth""",4,2,1,1,50.0,15000.00\r\n');
    expect(toCsv(["Source"], [["=HYPERLINK(\"http://evil\")"], ["+1"], ["@x"], ["-2"], ["plain"]])).toBe("Source\r\n\"'=HYPERLINK(\"\"http://evil\"\")\"\r\n'+1\r\n'@x\r\n'-2\r\nplain\r\n");
  });
});
