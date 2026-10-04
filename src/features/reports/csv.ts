import { LOST_REASON_LABELS, STAGE_LABELS } from "@/lib/deal-status";
import type { Reports } from "@/features/reports/queries";

/** The five report tables as headers and rows, shared by the page and the CSV download. */
export const REPORT_NAMES = ["leads-by-source", "pipeline-by-stage", "revenue-by-month", "rep-performance", "lost-reasons"] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

const dollars = (cents: number) => (cents / 100).toFixed(2);
const percent = (rate: number | null) => (rate === null ? "" : (Number(rate) * 100).toFixed(1));
const number = (value: number | null) => (value === null ? "" : String(value));

export function reportTable(name: ReportName, reports: Reports): { title: string; headers: string[]; rows: string[][] } {
  switch (name) {
    case "leads-by-source":
      return {
        title: "Leads by source",
        headers: ["Source", "Leads", "Won", "Lost", "Open", "Conversion %", "Sold ($)"],
        rows: reports.bySource.map((r) => [r.source, String(r.leads), String(r.won), String(r.lost), String(r.open), percent(r.cohort_conversion), dollars(r.sold_cents)]),
      };
    case "pipeline-by-stage":
      return {
        title: "Pipeline by stage",
        headers: ["Stage", "Deals", "Value ($)", "Avg days in stage"],
        rows: reports.byStage.map((r) => [STAGE_LABELS[r.stage], String(r.deals), dollars(r.value_cents), number(r.avg_days_in_stage)]),
      };
    case "revenue-by-month":
      return {
        title: "Sold revenue by month",
        headers: ["Month", "Deals won", "Sold ($)"],
        rows: reports.byMonth.map((r) => [r.month.slice(0, 7), String(r.won_count), dollars(r.sold_cents)]),
      };
    case "rep-performance":
      return {
        title: "Sales rep performance",
        headers: ["Rep", "Leads assigned", "Won", "Lost", "Close rate %", "Sold ($)", "Avg days to close", "Median minutes to first attempt", "Overdue tasks"],
        rows: reports.reps.map((r) => [r.owner_name, String(r.leads_assigned), String(r.won), String(r.lost), percent(r.close_rate), dollars(r.sold_cents), number(r.avg_days_to_close), number(r.median_minutes_to_first_attempt), String(r.overdue_tasks)]),
      };
    case "lost-reasons":
      return {
        title: "Lost reasons",
        headers: ["Reason", "Deals", "Estimated value ($)"],
        rows: reports.lost.map((r) => [LOST_REASON_LABELS[r.reason], String(r.deals), dollars(r.value_cents)]),
      };
  }
}

/** RFC 4180 CSV. A leading =, +, -, or @ is prefixed so a spreadsheet does not treat a cell as a formula. */
export function toCsv(headers: string[], rows: string[][]): string {
  const cell = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
