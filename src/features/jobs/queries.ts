import "server-only";
import { formatDay } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Enums = Database["public"]["Enums"];
export type JobStatus = Enums["job_status"];

const address = (p: { address_line1: string; city: string | null; state?: string | null; postal_code?: string | null } | null) =>
  p ? [p.address_line1, p.city, p.state, p.postal_code].filter(Boolean).join(", ") : null;

/** "Oct 7 – Oct 9", "Oct 7", or null when the job has no dates yet. */
export function scheduleLabel(start: string | null, end: string | null) {
  if (!start) return null;
  return end && end !== start ? `${formatDay(start)} – ${formatDay(end)}` : formatDay(start);
}

export type JobRow = {
  id: string;
  number: string;
  title: string;
  customerName: string;
  address: string | null;
  workType: Enums["work_type"];
  status: JobStatus;
  schedule: string | null;
  crew: string[];
};

/**
 * Jobs, newest first. RLS returns every job to staff and only assigned jobs to field users.
 * No money is selected: the jobs table has none, and this query must stay that way (CLAUDE.md rule 14).
 * Search runs in memory over the fetched page; a company this size has hundreds of jobs, not thousands.
 */
export async function listJobs(filters: { status?: string; q?: string } = {}): Promise<JobRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select(
      `id, job_number, title, work_type, status, scheduled_start, scheduled_end,
       customer:customers!inner(first_name, last_name),
       property:properties(address_line1, city),
       job_assignments(user:profiles(full_name))`,
    )
    .order("created_at", { ascending: false })
    .range(0, 499);
  if (filters.status === "open") query = query.in("status", ["pending_schedule", "scheduled", "in_progress", "on_hold"]);
  else if (filters.status) query = query.eq("status", filters.status as JobStatus);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data.map<JobRow>((j) => ({
    id: j.id,
    number: `J-${j.job_number}`,
    title: j.title,
    customerName: `${j.customer.first_name} ${j.customer.last_name}`.trim(),
    address: address(j.property),
    workType: j.work_type,
    status: j.status,
    schedule: scheduleLabel(j.scheduled_start, j.scheduled_end),
    crew: j.job_assignments.flatMap((a) => (a.user ? [a.user.full_name] : [])).sort(),
  }));
  const q = filters.q?.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => [r.number, r.title, r.customerName, r.address ?? ""].some((v) => v.toLowerCase().includes(q)));
}

/** One job with what every role may read: customer, property, crew, and work days. */
export async function getJob(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      `id, job_number, title, work_type, status, scheduled_start, scheduled_end, started_at, completed_at,
       permit_status, permit_number, warranty_years, warranty_expires_on, scope_summary, opportunity_id, customer_id,
       customer:customers!inner(first_name, last_name, phone, phone_e164),
       property:properties(address_line1, city, state, postal_code, access_notes),
       job_assignments(user_id, user:profiles(full_name, role)),
       appointments(id, starts_at, status, assigned_to, type, assignee:profiles!appointments_assigned_to_fkey(full_name))`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, address: address(data.property) };
}
export type JobDetail = NonNullable<Awaited<ReturnType<typeof getJob>>>;

/** Notes on the job's deal, newest first. RLS hides staff-only notes from field users. */
export async function listJobNotes(opportunityId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select("id, body, created_at, shared_with_crew, author:profiles(full_name)")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

/** Staff only: contract amount, invoices, and timeline. Never call this for a field user. */
export async function getJobStaffDetail(jobId: string, opportunityId: string) {
  const supabase = await createClient();
  const [deal, invoices, activities] = await Promise.all([
    supabase.from("opportunities").select("amount_cents, owner:profiles!opportunities_owner_id_fkey(full_name)").eq("id", opportunityId).maybeSingle(),
    supabase.from("invoices").select("id, invoice_number, kind, status, total_cents, due_on").eq("job_id", jobId).order("invoice_number"),
    supabase.from("activities").select("id, type, summary, occurred_at").eq("opportunity_id", opportunityId).order("occurred_at", { ascending: false }).limit(30),
  ]);
  return { amountCents: deal.data?.amount_cents ?? null, owner: deal.data?.owner?.full_name ?? null, invoices: invoices.data ?? [], activities: activities.data ?? [] };
}

/** Staff only: a job's invoices, for the deal page. */
export async function listJobInvoices(jobId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("invoices").select("id, invoice_number, kind, status, total_cents, due_on").eq("job_id", jobId).order("invoice_number");
  return data ?? [];
}
