import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Leads inbox: deals in New and Contacted, newest first, with their next open task. */
export async function listLeads() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opportunities")
    .select(
      `id, title, stage, work_type, created_at, owner_id, customer_id,
       customer:customers!inner(first_name, last_name, phone, phone_e164),
       source:lead_sources(name),
       owner:profiles!opportunities_owner_id_fkey(full_name),
       tasks(id, title, due_at, status)`,
    )
    .in("stage", ["new", "contacted"])
    .eq("tasks.status", "open")
    .order("created_at", { ascending: false })
    .order("due_at", { referencedTable: "tasks", ascending: true })
    .limit(1, { referencedTable: "tasks" })
    .range(0, 99);
  if (error) throw error;
  return data;
}

export type LeadRow = Awaited<ReturnType<typeof listLeads>>[number];

export async function listLeadSources() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("lead_sources").select("id, name, is_active, sort_order").order("sort_order");
  if (error) throw error;
  return data;
}
