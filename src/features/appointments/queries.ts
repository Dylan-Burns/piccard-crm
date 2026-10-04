import "server-only";
import { fromZonedTime } from "date-fns-tz";
import { addDays, businessDate, formatDateTime, formatTime, timeInputValue } from "@/lib/dates";
import { telHref } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Enums = Database["public"]["Enums"];

export const APPOINTMENT_TYPE_LABELS: Record<Enums["appointment_type"], string> = {
  inspection: "Inspection",
  estimate_presentation: "Estimate review",
  job_work: "Job",
  other: "Other",
};

/** One appointment, formatted for display and safe to pass to client components. */
export type CalendarItem = {
  id: string;
  title: string;
  type: Enums["appointment_type"];
  typeLabel: string;
  status: Enums["appointment_status"];
  /** yyyy-MM-dd in the company timezone */
  day: string;
  /** "10:00 AM" or "All day" */
  timeLabel: string;
  /** "Oct 7, 10:00 AM" */
  whenLabel: string;
  /** values for the reschedule form */
  timeInput: string;
  durationMinutes: number;
  allDay: boolean;
  customerName: string;
  address: string | null;
  mapsUrl: string | null;
  tel: string | null;
  accessNotes: string | null;
  assigneeId: string;
  assignee: string;
  notes: string | null;
  outcomeNotes: string | null;
  opportunityId: string;
  jobId: string | null;
  /** Google Calendar state; `not_synced` when Google is not connected. */
  sync: Enums["sync_status"];
  syncError: string | null;
};

export type AppointmentFilters = { assignee?: string; type?: string; opportunityId?: string; includeClosed?: boolean };

/** Appointments whose start falls on the days [fromDay, toDayExclusive) in the company timezone. RLS scopes field users to their own. */
export async function listAppointments(fromDay: string | null, toDayExclusive: string | null, timeZone: string, filters: AppointmentFilters = {}): Promise<CalendarItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from("appointments")
    .select(
      `id, title, type, status, starts_at, ends_at, all_day, notes, outcome_notes, opportunity_id, job_id, assigned_to, google_sync_status, google_sync_error,
       customer:customers!inner(first_name, last_name, phone, phone_e164),
       property:properties(address_line1, city, state, postal_code, access_notes),
       assignee:profiles!appointments_assigned_to_fkey(full_name)`,
    )
    .order("starts_at")
    .range(0, 499);
  if (fromDay) query = query.gte("starts_at", fromZonedTime(`${fromDay}T00:00:00`, timeZone).toISOString());
  if (toDayExclusive) query = query.lt("starts_at", fromZonedTime(`${toDayExclusive}T00:00:00`, timeZone).toISOString());
  if (filters.assignee) query = query.eq("assigned_to", filters.assignee);
  if (filters.type) query = query.eq("type", filters.type as Enums["appointment_type"]);
  if (filters.opportunityId) query = query.eq("opportunity_id", filters.opportunityId);
  if (!filters.includeClosed) query = query.in("status", ["scheduled", "completed"]);

  const { data, error } = await query;
  if (error) throw error;
  return data.map((a) => {
    const address = a.property ? [a.property.address_line1, a.property.city, a.property.state, a.property.postal_code].filter(Boolean).join(", ") : null;
    return {
      id: a.id,
      title: a.title,
      type: a.type,
      typeLabel: APPOINTMENT_TYPE_LABELS[a.type],
      status: a.status,
      day: businessDate(a.starts_at, timeZone),
      timeLabel: a.all_day ? "All day" : formatTime(a.starts_at, timeZone),
      whenLabel: a.all_day ? formatDateTime(a.starts_at, timeZone).split(",")[0]! : formatDateTime(a.starts_at, timeZone),
      timeInput: timeInputValue(a.starts_at, timeZone),
      durationMinutes: Math.max(15, Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000)),
      allDay: a.all_day,
      customerName: `${a.customer.first_name} ${a.customer.last_name}`.trim(),
      address,
      mapsUrl: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null,
      tel: telHref(a.customer.phone, a.customer.phone_e164),
      accessNotes: a.property?.access_notes ?? null,
      assigneeId: a.assigned_to,
      assignee: a.assignee?.full_name ?? "Unassigned",
      notes: a.notes,
      outcomeNotes: a.outcome_notes,
      opportunityId: a.opportunity_id,
      jobId: a.job_id,
      sync: a.google_sync_status,
      syncError: a.google_sync_error,
    };
  });
}

/** Today in the company timezone, and the day after (an exclusive upper bound). */
export function todayRange(timeZone: string, now: Date = new Date()) {
  const today = businessDate(now, timeZone);
  return { today, tomorrow: addDays(today, 1) };
}

/** Open deals for the "new appointment" picker on the calendar (staff only by RLS). */
export async function listOpenDealOptions() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("opportunities")
    .select("id, title, owner_id, customer:customers!inner(first_name, last_name)")
    .not("stage", "in", "(won,lost)")
    .order("created_at", { ascending: false })
    .range(0, 199);
  return (data ?? []).map((d) => ({ id: d.id, ownerId: d.owner_id, label: `${d.customer.first_name} ${d.customer.last_name} — ${d.title}`.trim() }));
}
