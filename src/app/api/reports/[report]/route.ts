import { NextResponse } from "next/server";
import { todayRange } from "@/features/appointments/queries";
import { REPORT_NAMES, reportTable, toCsv, type ReportName } from "@/features/reports/csv";
import { getReports } from "@/features/reports/queries";
import { resolveRange } from "@/features/reports/ranges";
import { currentProfileWithRole } from "@/lib/auth";
import { getTimeZone } from "@/lib/settings";

/** CSV download of one report table for the chosen range. Admins only, like the Reports page. */
export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  if (!(await currentProfileWithRole("admin"))) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { report } = await params;
  if (!(REPORT_NAMES as readonly string[]).includes(report)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const query = new URL(request.url).searchParams;
  const { today } = todayRange(await getTimeZone());
  const range = resolveRange({ range: query.get("range") ?? undefined, from: query.get("from") ?? undefined, to: query.get("to") ?? undefined }, today);
  const table = reportTable(report as ReportName, await getReports(range.from, range.to));
  return new NextResponse(toCsv(table.headers, table.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
