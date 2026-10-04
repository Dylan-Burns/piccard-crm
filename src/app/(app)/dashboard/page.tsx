import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { todayRange } from "@/features/appointments/queries";
import { RangePicker } from "@/features/reports/components/range-picker";
import { getDashboard, getNeedsAttention, getUpcomingAppointments, type AttentionItem } from "@/features/reports/queries";
import { resolveRange } from "@/features/reports/ranges";
import { requireRole } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { getTimeZone } from "@/lib/settings";

export const metadata: Metadata = { title: "Dashboard" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Dashboard (spec §9 Phase 11). Tile labels follow the definitions in §8 exactly. Admins see the
 * company; sales users see their own numbers (the report function is called with their id).
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const me = await requireRole("admin", "sales");
  const params = await searchParams;
  const timeZone = await getTimeZone();
  const { today } = todayRange(timeZone);
  const range = resolveRange({ range: first(params.range), from: first(params.from), to: first(params.to) }, today);
  const ownerId = me.role === "admin" ? null : me.id;

  const [tiles, attention, upcoming] = await Promise.all([
    getDashboard(range.from, range.to, ownerId),
    getNeedsAttention(ownerId, timeZone),
    getUpcomingAppointments(ownerId, today, timeZone),
  ]);
  const closed = tiles.won_count + tiles.lost_count;

  return (
    <>
      <PageHeader title="Dashboard" description={ownerId ? `Your numbers · ${range.label}` : `Company · ${range.label}`} />
      <div className="space-y-4 p-4 md:p-6">
        <RangePicker basePath="/dashboard" range={range} />

        <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tile label="New leads" value={String(tiles.new_leads)} note="Deals created in the period" />
          <Tile label="Revenue (sold)" value={formatCents(tiles.sold_cents)} note={`${tiles.won_count} won in the period`}>
            <dl className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Invoiced</dt>
                <dd className="font-medium tabular">{formatCents(tiles.invoiced_cents)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Outstanding</dt>
                <dd className="font-medium tabular">{formatCents(tiles.outstanding_cents)}</dd>
              </div>
            </dl>
          </Tile>
          <Tile
            label="Conversion rate"
            value={tiles.close_rate === null ? "—" : `${(Number(tiles.close_rate) * 100).toFixed(1)}%`}
            note={closed === 0 ? "No deals closed in the period" : `${tiles.won_count} won of ${closed} closed in the period`}
          />
          <Tile label="Active jobs" value={String(tiles.active_jobs)} note="Now, not affected by the date range" />
          <Tile label="Upcoming appointments" value={String(tiles.upcoming_appointments)} note="Next 7 days" />
          <Tile label="Pipeline value" value={formatCents(tiles.pipeline_cents)} note="Open deals, estimated" />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-label="Needs attention" className="panel min-w-0 space-y-4">
            <h2 className="panel-head font-semibold">Needs attention</h2>
            <AttentionList title="Unassigned leads" items={attention.unassignedLeads} empty="Every lead has an owner." more="/leads" />
            <AttentionList title="Overdue tasks" items={attention.overdueTasks} empty="Nothing is overdue." more="/tasks" />
            <AttentionList title="Deals with no next step" items={attention.noNextStep} empty="Every open deal has a next step." more="/pipeline" />
          </section>

          <section aria-label="Next seven days" className="panel min-w-0 space-y-3">
            <h2 className="panel-head font-semibold">Next seven days</h2>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground">No appointments scheduled.</p>
            ) : (
              <ul className="divide-y rounded-md border bg-card">
                {upcoming.map((a) => (
                  <li key={a.id}>
                    <Link href={a.href} className="flex min-h-11 items-center gap-3 px-3 py-1.5 hover:bg-muted/50">
                      <span className="w-28 shrink-0 text-xs text-muted-foreground tabular">{a.when}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{a.assignee}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, note, children }: { label: string; value: string; note: string; children?: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="panel">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
      {children}
    </div>
  );
}

function AttentionList({ title, items, empty, more }: { title: string; items: AttentionItem[]; empty: string; more: string }) {
  const shown = items.slice(0, 5);
  return (
    <div role="group" aria-label={title} className="space-y-1.5">
      <h3 className="flex items-center justify-between text-sm font-medium">
        <span>
          {title} <span className={items.length > 0 ? "text-destructive tabular" : "text-muted-foreground tabular"}>({items.length})</span>
        </span>
        {items.length > shown.length ? (
          <Link href={more} className="text-xs font-normal text-primary hover:underline">
            View all
          </Link>
        ) : null}
      </h3>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {shown.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5 hover:bg-muted/50">
                <span className="min-w-0 truncate font-medium">{item.label}</span>
                <span className="min-w-0 shrink truncate text-xs text-muted-foreground">{item.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
