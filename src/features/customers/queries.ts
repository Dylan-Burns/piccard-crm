import "server-only";
import { toE164 } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export const CUSTOMERS_PAGE_SIZE = 50;

/** Strips characters that have meaning in a PostgREST filter string. */
function safeTerm(term: string) {
  return term.replace(/[,()*%\\"]/g, "").trim();
}

/**
 * Customer list with search across name, company, email, phone, and property address.
 * Each word must match one of the name/email/company fields; a phone-like query matches phone digits;
 * the whole query is also tried against street addresses.
 */
export async function listCustomers(search: string, page: number) {
  const supabase = await createClient();
  const from = (page - 1) * CUSTOMERS_PAGE_SIZE;
  let query = supabase
    .from("customers")
    .select("id, first_name, last_name, company_name, phone, phone_e164, email, properties(address_line1, city, is_primary), opportunities(stage)", { count: "exact" })
    .is("archived_at", null)
    .order("last_name")
    .order("first_name")
    .range(from, from + CUSTOMERS_PAGE_SIZE - 1);

  const q = safeTerm(search);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const byAddress = await supabase.from("properties").select("customer_id").ilike("address_line1", `%${q}%`).limit(200);
    const addressIds = [...new Set((byAddress.data ?? []).map((p) => p.customer_id))];

    if (digits.length >= 4 && digits.length === q.replace(/[\s().+-]/g, "").length) {
      const e164 = toE164(q);
      const phoneFilter = e164 ? `phone_e164.eq.${e164}` : `phone_e164.ilike.*${digits}*`;
      query = query.or(addressIds.length ? `${phoneFilter},id.in.(${addressIds.join(",")})` : phoneFilter);
    } else {
      const words = q.split(/\s+/).map(safeTerm).filter(Boolean).slice(0, 4);
      const nameClause = `and(${words
        .map((w) => `or(first_name.ilike.*${w}*,last_name.ilike.*${w}*,company_name.ilike.*${w}*,email.ilike.*${w}*)`)
        .join(",")})`;
      query = query.or(addressIds.length ? `${nameClause},id.in.(${addressIds.join(",")})` : nameClause);
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { customers: data, total: count ?? 0 };
}

export type CustomerListRow = Awaited<ReturnType<typeof listCustomers>>["customers"][number];

export async function getCustomerDetail(id: string) {
  const supabase = await createClient();
  const [customer, activities, notes, tasks] = await Promise.all([
    supabase
      .from("customers")
      .select(
        `id, first_name, last_name, company_name, email, phone, phone_e164, secondary_phone, preferred_contact,
         billing_address_line1, billing_city, billing_state, billing_postal_code,
         properties(id, label, address_line1, address_line2, city, state, postal_code, access_notes, is_primary),
         opportunities(id, title, stage, work_type, estimated_value_cents, amount_cents, lost_reason, owner_id, created_at, property_id,
           owner:profiles!opportunities_owner_id_fkey(full_name),
           estimates(estimate_number, version, status, total_cents, created_at),
           appointments(type, status, starts_at),
           jobs(id, job_number, status))`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("activities")
      .select("id, type, summary, metadata, occurred_at, opportunity_id, actor:profiles(full_name)")
      .eq("customer_id", id)
      .order("occurred_at", { ascending: false })
      .limit(30),
    supabase.from("notes").select("id, body, shared_with_crew, author_id").eq("customer_id", id).order("created_at", { ascending: false }).limit(60),
    supabase
      .from("tasks")
      .select("id, title, due_at, opportunity_id, assignee:profiles!tasks_assigned_to_fkey(full_name)")
      .eq("customer_id", id)
      .eq("status", "open")
      .order("due_at"),
  ]);
  if (customer.error) throw customer.error;
  if (!customer.data) return null;
  return {
    customer: customer.data,
    activities: activities.data ?? [],
    notes: notes.data ?? [],
    tasks: tasks.data ?? [],
  };
}

export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>;
export type CustomerDeal = CustomerDetail["customer"]["opportunities"][number];

/** Which milestone activity types exist on a deal (for the milestone strip). */
export async function getDealMilestones(opportunityId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activities")
    .select("type")
    .eq("opportunity_id", opportunityId)
    .in("type", ["lead_received", "call", "email", "sms", "appointment_completed", "files_uploaded", "estimate_sent"]);
  return new Set((data ?? []).map((a) => a.type));
}
