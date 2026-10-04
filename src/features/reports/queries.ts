import "server-only";
import { fromZonedTime } from "date-fns-tz";
import { addDays, dueState, formatDateTime } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

/**
 * Dashboard and report data. The numbers come from the SQL functions in spec §8, which run as the
 * signed-in user, so RLS applies. `ownerId` null means the whole company (admins); sales users
 * pass their own id.
 */

export async function getDashboard(from: string, to: string, ownerId: string | null) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_dashboard", { p_from: from, p_to: to, ...(ownerId ? { p_owner: ownerId } : {}) });
  if (error) throw error;
  return data[0]!;
}

export type AttentionItem = { id: string; label: string; detail: string; href: string };

/** Unassigned leads, overdue tasks, and open deals with no next step (spec §4.4). */
export async function getNeedsAttention(ownerId: string | null, timeZone: string) {
  const supabase = await createClient();
  const now = new Date().toISOString();
  let tasksQuery = supabase
    .from("tasks")
    .select("id, title, due_at, opportunity_id, customer:customers(first_name, last_name), assignee:profiles!tasks_assigned_to_fkey(full_name)")
    .eq("status", "open")
    .lt("due_at", now)
    .order("due_at")
    .limit(100);
  if (ownerId) tasksQuery = tasksQuery.eq("assigned_to", ownerId);
  let dealsQuery = supabase
    .from("opportunities")
    .select("id, title, owner_id, customer:customers!inner(first_name, last_name), tasks(id, status), appointments(id, status, starts_at)")
    .not("stage", "in", "(won,lost)")
    .range(0, 499);
  if (ownerId) dealsQuery = dealsQuery.eq("owner_id", ownerId);

  const [unassigned, tasks, deals] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id, title, created_at, customer:customers!inner(first_name, last_name)")
      .in("stage", ["new", "contacted"])
      .is("owner_id", null)
      .order("created_at")
      .limit(100),
    tasksQuery,
    dealsQuery,
  ]);
  const name = (c: { first_name: string; last_name: string } | null) => (c ? `${c.first_name} ${c.last_name}`.trim() : "");

  return {
    unassignedLeads: (unassigned.data ?? []).map<AttentionItem>((d) => ({ id: d.id, label: name(d.customer), detail: d.title, href: `/opportunities/${d.id}` })),
    overdueTasks: (tasks.data ?? [])
      .filter((t) => dueState(t.due_at, timeZone) === "overdue")
      .map<AttentionItem>((t) => ({
        id: t.id,
        label: t.title,
        detail: [name(t.customer), formatDateTime(t.due_at, timeZone), ownerId ? null : t.assignee?.full_name].filter(Boolean).join(" · "),
        href: t.opportunity_id ? `/opportunities/${t.opportunity_id}` : "/tasks",
      })),
    noNextStep: (deals.data ?? [])
      .filter((d) => !d.tasks.some((t) => t.status === "open") && !d.appointments.some((a) => a.status === "scheduled" && a.starts_at > now))
      .map<AttentionItem>((d) => ({ id: d.id, label: name(d.customer), detail: d.title, href: `/opportunities/${d.id}` })),
  };
}

/** Scheduled appointments in the next seven days: everyone's for admins, a rep's own deals for sales. */
export async function getUpcomingAppointments(ownerId: string | null, today: string, timeZone: string) {
  const supabase = await createClient();
  let query = supabase
    .from("appointments")
    .select("id, title, starts_at, all_day, opportunity_id, assignee:profiles!appointments_assigned_to_fkey(full_name), opportunity:opportunities!inner(owner_id)")
    .eq("status", "scheduled")
    .gte("starts_at", fromZonedTime(`${today}T00:00:00`, timeZone).toISOString())
    .lt("starts_at", fromZonedTime(`${addDays(today, 7)}T00:00:00`, timeZone).toISOString())
    .order("starts_at")
    .limit(50);
  if (ownerId) query = query.eq("opportunity.owner_id", ownerId);
  const { data } = await query;
  return (data ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    when: a.all_day ? formatDateTime(a.starts_at, timeZone).split(",")[0]! : formatDateTime(a.starts_at, timeZone),
    assignee: a.assignee?.full_name ?? "",
    href: `/opportunities/${a.opportunity_id}`,
  }));
}

/** The five report tables (spec §8.2 to §8.6). Admin page; the functions themselves follow RLS. */
export async function getReports(from: string, to: string) {
  const supabase = await createClient();
  const [bySource, byStage, byMonth, reps, lost] = await Promise.all([
    supabase.rpc("report_leads_by_source", { p_from: from, p_to: to }),
    supabase.rpc("report_pipeline_by_stage", {}),
    supabase.rpc("report_revenue_by_month", { p_months: 12 }),
    supabase.rpc("report_rep_performance", { p_from: from, p_to: to }),
    supabase.rpc("report_lost_reasons", { p_from: from, p_to: to }),
  ]);
  for (const r of [bySource, byStage, byMonth, reps, lost]) if (r.error) throw r.error;
  return { bySource: bySource.data!, byStage: byStage.data!, byMonth: byMonth.data!, reps: reps.data!, lost: lost.data! };
}
export type Reports = Awaited<ReturnType<typeof getReports>>;
