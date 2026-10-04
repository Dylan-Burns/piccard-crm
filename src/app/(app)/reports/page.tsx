import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { todayRange } from "@/features/appointments/queries";
import { RangePicker } from "@/features/reports/components/range-picker";
import { REPORT_NAMES, reportTable } from "@/features/reports/csv";
import { getReports } from "@/features/reports/queries";
import { rangeQuery, resolveRange } from "@/features/reports/ranges";
import { requireRole } from "@/lib/auth";
import { getTimeZone } from "@/lib/settings";

export const metadata: Metadata = { title: "Reports" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
/** Reports that do not depend on the chosen range. */
const SNAPSHOT: Record<string, string> = { "pipeline-by-stage": "Now", "revenue-by-month": "Last 12 months" };

/** The five tables from spec §8.2 to §8.6, with a range picker, CSS bars, and a CSV per table. Admin only. */
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await requireRole("admin");
  const params = await searchParams;
  const { today } = todayRange(await getTimeZone());
  const range = resolveRange({ range: first(params.range), from: first(params.from), to: first(params.to) }, today);
  const reports = await getReports(range.from, range.to);

  return (
    <>
      <PageHeader title="Reports" description={range.label} />
      <div className="space-y-4 p-4 md:p-6">
        <RangePicker basePath="/reports" range={range} />
        {REPORT_NAMES.map((name) => {
          const table = reportTable(name, reports);
          // The second column is each table's count; it drives the bar.
          const max = Math.max(1, ...table.rows.map((row) => Number(row[1]) || 0));
          return (
            <section key={name} aria-label={table.title} className="panel space-y-3">
              <div className="panel-head">
                <h2 className="font-semibold">
                  {table.title} <span className="font-normal text-muted-foreground">· {SNAPSHOT[name] ?? range.label}</span>
                </h2>
                <Button asChild variant="outline" className="h-11 md:h-8">
                  <a href={`/api/reports/${name}?${rangeQuery(range)}`} download aria-label={`Download ${table.title} as CSV`}>
                    <Download className="size-4" aria-hidden />
                    CSV
                  </a>
                </Button>
              </div>
              {table.rows.length === 0 ? (
                <p className="text-muted-foreground">Nothing in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="border-b text-xs text-muted-foreground">
                      <tr>
                        {table.headers.map((header, index) => (
                          <th key={header} className={index === 0 ? "h-9 pr-3 font-medium" : "px-3 text-right font-medium"}>
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {table.rows.map((row) => (
                        <tr key={row[0]} className="h-10">
                          {row.map((value, index) =>
                            index === 0 ? (
                              <th key={index} scope="row" className="pr-3 font-medium whitespace-nowrap">
                                {value}
                              </th>
                            ) : (
                              <td key={index} className="px-3 text-right tabular whitespace-nowrap">
                                {index === 1 ? (
                                  <span className="inline-flex items-center gap-2">
                                    <span aria-hidden className="hidden h-2 rounded-sm bg-primary/40 sm:inline-block" style={{ width: `${Math.round((Number(value) / max) * 64)}px` }} />
                                    {value}
                                  </span>
                                ) : (
                                  value || "—"
                                )}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
