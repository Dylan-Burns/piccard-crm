import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function getOpportunityDetail(id: string) {
  const supabase = await createClient();
  const [deal, activities, notes, tasks] = await Promise.all([
    supabase
      .from("opportunities")
      .select(
        `id, title, stage, work_type, description, estimated_value_cents, amount_cents, lost_reason, lost_notes, lost_competitor,
         owner_id, source_id, source_detail, property_id, customer_id, created_at, possible_duplicate_of,
         is_insurance_claim, insurance_carrier, claim_number, adjuster_name, adjuster_phone, deductible_cents,
         customer:customers!inner(id, first_name, last_name, phone, phone_e164, email,
           properties(id, label, address_line1, city, state, postal_code, access_notes, is_primary)),
         owner:profiles!opportunities_owner_id_fkey(full_name),
         source:lead_sources(name),
         estimates(id, estimate_number, version, status, title, total_cents, created_at),
         appointments(id, type, status, starts_at),
         jobs(id, job_number, status)`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("activities")
      .select("id, type, summary, metadata, occurred_at, actor:profiles(full_name)")
      .eq("opportunity_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase.from("notes").select("id, body, shared_with_crew").eq("opportunity_id", id).order("created_at", { ascending: false }).limit(100),
    supabase
      .from("tasks")
      .select("id, title, due_at, assignee:profiles!tasks_assigned_to_fkey(full_name)")
      .eq("opportunity_id", id)
      .eq("status", "open")
      .order("due_at"),
  ]);
  if (deal.error) throw deal.error;
  if (!deal.data) return null;

  let duplicateOf: { id: string; title: string } | null = null;
  if (deal.data.possible_duplicate_of) {
    const { data } = await supabase.from("opportunities").select("id, title").eq("id", deal.data.possible_duplicate_of).maybeSingle();
    duplicateOf = data;
  }
  return { deal: deal.data, activities: activities.data ?? [], notes: notes.data ?? [], tasks: tasks.data ?? [], duplicateOf };
}

export type OpportunityDetail = NonNullable<Awaited<ReturnType<typeof getOpportunityDetail>>>;
