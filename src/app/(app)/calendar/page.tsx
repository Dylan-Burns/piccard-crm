import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shell/page-header";
import { AppointmentChip, AppointmentRow } from "@/features/appointments/components/appointment-dialog";
import { ScheduleAppointmentDialog } from "@/features/appointments/components/schedule-appointment-dialog";
import { WeekGrid } from "@/features/appointments/components/week-grid";
import { APPOINTMENT_TYPE_LABELS, listAppointments, listOpenDealOptions, todayRange, type CalendarItem } from "@/features/appointments/queries";
import { requireRole } from "@/lib/auth";
import { addDays, addMonths, formatDay, startOfMonth, startOfWeek } from "@/lib/dates";
import { getTimeZone, listUserOptions } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const me = await requireRole();
  const isStaff = me.role !== "field";
  const params = await searchParams;
  const pick = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const timeZone = await getTimeZone();
  const { today } = todayRange(timeZone);

  const view = pick("view") === "month" ? "month" : "week";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(pick("date")) ? pick("date") : today;
  const assignee = isStaff ? pick("assignee") : "";
  const type = pick("type");

  // The visible range: a Sunday-to-Saturday week, or whole weeks covering the month.
  const rangeStart = view === "week" ? startOfWeek(anchor) : startOfWeek(startOfMonth(anchor));
  const rangeEnd = view === "week" ? addDays(rangeStart, 7) : addDays(startOfWeek(addDays(addMonths(startOfMonth(anchor), 1), -1)), 7);
  const dayCount = Math.round((new Date(`${rangeEnd}T00:00:00Z`).getTime() - new Date(`${rangeStart}T00:00:00Z`).getTime()) / 86_400_000);
  const days = Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i));

  const [items, users, deals] = await Promise.all([
    listAppointments(rangeStart, rangeEnd, timeZone, { assignee: assignee || undefined, type: type || undefined }),
    listUserOptions(),
    isStaff ? listOpenDealOptions() : Promise.resolve([]),
  ]);
  const permissions = { isStaff, userId: me.id };
  const byDay = (day: string) => items.filter((i) => i.day === day);

  const href = (changes: Record<string, string>) => {
    const next = { view, date: anchor, assignee, type, ...changes };
    return `/calendar?${new URLSearchParams(Object.entries(next).filter(([, v]) => v))}`;
  };
  const previous = view === "week" ? addDays(anchor, -7) : addMonths(anchor, -1);
  const next = view === "week" ? addDays(anchor, 7) : addMonths(anchor, 1);
  const title = view === "week" ? `${formatDay(rangeStart)} – ${formatDay(addDays(rangeStart, 6))}` : formatDay(anchor, "month");

  return (
    <>
      <PageHeader
        title="Calendar"
        actions={
          isStaff ? (
            <ScheduleAppointmentDialog
              defaults={{ date: anchor < today ? today : anchor, assigneeId: me.id }}
              users={users}
              deals={deals}
              trigger={
                <Button className="h-11 md:h-9">
                  <Plus className="size-4" aria-hidden />
                  New appointment
                </Button>
              }
            />
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 md:px-6">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon" className="size-11 md:size-9">
            <Link href={href({ date: previous })} aria-label={view === "week" ? "Previous week" : "Previous month"}>
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11 md:h-9">
            <Link href={href({ date: today })}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="icon" className="size-11 md:size-9">
            <Link href={href({ date: next })} aria-label={view === "week" ? "Next week" : "Next month"}>
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
        <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
        {/* Month view is desktop only; phones always get the agenda. */}
        <div className="hidden rounded-md border bg-card p-0.5 md:flex" role="group" aria-label="View">
          {(["week", "month"] as const).map((v) => (
            <Link key={v} href={href({ view: v })} aria-current={view === v ? "true" : undefined} className={cn("flex h-8 items-center rounded px-3 capitalize", view === v ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground")}>
              {v}
            </Link>
          ))}
        </div>
        <form action="/calendar" className="flex w-full gap-2 md:w-auto">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={anchor} />
          {isStaff ? (
            <NativeSelect name="assignee" aria-label="Person" defaultValue={assignee} className="flex-1 md:w-40">
              <option value="">Everyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <NativeSelect name="type" aria-label="Type" defaultValue={type} className="flex-1 md:w-40">
            <option value="">All types</option>
            {Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline" className="h-11 md:h-9">
            Apply
          </Button>
        </form>
      </div>

      <div className="p-4 md:p-6">
        {/* Phones (and an empty range): agenda grouped by day */}
        <div className={cn("space-y-4", items.length > 0 && "md:hidden")}>
          {items.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Nothing scheduled" description={view === "week" ? "No appointments this week." : "No appointments this month."} />
          ) : (
            days
              .filter((day) => byDay(day).length > 0)
              .map((day) => (
                <section key={day} aria-label={formatDay(day, "long")}>
                  <h3 className={cn("mb-1 text-xs font-semibold", day === today ? "text-primary" : "text-muted-foreground")}>
                    {day === today ? "Today · " : ""}
                    {formatDay(day, "long")}
                  </h3>
                  <ul className="divide-y overflow-hidden rounded-md border bg-card">
                    {byDay(day).map((item) => (
                      <li key={item.id}>
                        <AppointmentRow item={item} permissions={permissions} users={users} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
          )}
        </div>

        {/* Desktop grids */}
        {items.length > 0 ? (
          <div className="hidden md:block">
            {view === "week" ? (
              <WeekGrid days={days.map((day) => ({ day, label: formatDay(day), isToday: day === today }))} items={items} permissions={permissions} users={users} />
            ) : (
              <MonthGrid days={days} month={anchor.slice(0, 7)} today={today} byDay={byDay} permissions={permissions} users={users} />
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

function MonthGrid({
  days,
  month,
  today,
  byDay,
  permissions,
  users,
}: {
  days: string[];
  month: string;
  today: string;
  byDay: (day: string) => CalendarItem[];
  permissions: { isStaff: boolean; userId: string };
  users: { id: string; name: string }[];
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const items = byDay(day);
          return (
            <div key={day} className={cn("min-h-24 space-y-1 border-r border-b p-1 [&:nth-child(7n)]:border-r-0", !day.startsWith(month) && "bg-muted/30")}>
              <p className={cn("px-1 text-xs tabular", day === today ? "font-semibold text-primary" : "text-muted-foreground")}>{Number(day.slice(8))}</p>
              {items.slice(0, 3).map((item) => (
                <AppointmentChip key={item.id} item={item} permissions={permissions} users={users} />
              ))}
              {items.length > 3 ? (
                <Link href={`/calendar?view=week&date=${day}`} className="block px-1 text-xs text-primary hover:underline">
                  +{items.length - 3} more
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
