"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { assignOwnerSchema, leadFormSchema, logContactSchema } from "@/features/leads/schemas";
import { currentProfileWithRole } from "@/lib/auth";
import { toE164 } from "@/lib/phone";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { unwrapRpc, type RpcResult } from "@/lib/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { notifyLead } from "@/features/leads/ingest";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");

function revalidateDeal(customerId?: string) {
  revalidatePath("/leads");
  revalidatePath("/tasks");
  revalidatePath("/pipeline");
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function createLead(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = leadFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const input = parsed.data;

  const supabase = await createClient();
  const response = await supabase.rpc("create_lead", {
    p: { ...input, channel: "manual", phone_e164: toE164(input.phone) },
  });
  const result = unwrapRpc<RpcResult & { customer_id: string; opportunity_id: string; owner_id: string | null; status: string }>(response);
  if (!result.ok) return result;

  // Tell the owner about a lead someone else entered for them. Runs after the response.
  if (result.data.owner_id !== me.id) {
    const { opportunity_id, status } = result.data;
    after(async () => {
      const db = createAdminClient();
      const { data: customer } = await db.from("customers").select("first_name, last_name, phone").eq("id", result.data.customer_id).maybeSingle();
      const { data: source } = input.source_id ? await db.from("lead_sources").select("name").eq("id", input.source_id).maybeSingle() : { data: null };
      await notifyLead(db, opportunity_id, { ok: true, status, opportunity_id }, {
        first_name: customer?.first_name ?? input.first_name,
        last_name: customer?.last_name ?? input.last_name,
        phone: customer?.phone ?? input.phone,
        work_type: input.work_type,
        address_line1: input.address_line1,
        source_name: source?.name ?? "",
        message: input.message,
      });
    });
  }

  revalidateDeal(result.data.customer_id);
  redirect(`/customers/${result.data.customer_id}`);
}

export type DuplicateMatch = {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  matchedOn: ("phone" | "email" | "address")[];
  addresses: string[];
  openDeals: { id: string; title: string }[];
};

/** Live duplicate check for the new-lead form. Reads under the caller's RLS. */
export async function checkDuplicates(input: { phone: string; email: string; address: string; postalCode: string }): Promise<DuplicateMatch[]> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return [];
  const supabase = await createClient();
  const reasons = new Map<string, Set<"phone" | "email" | "address">>();
  const add = (id: string, why: "phone" | "email" | "address") => reasons.set(id, (reasons.get(id) ?? new Set()).add(why));

  const e164 = toE164(input.phone);
  const email = input.email.trim().toLowerCase();
  const addressKey = (input.address + " " + input.postalCode).toLowerCase().replace(/[^a-z0-9]/g, "");

  const [byPhone, byEmail, byAddress] = await Promise.all([
    e164 ? supabase.from("customers").select("id").eq("phone_e164", e164).is("archived_at", null).limit(5) : null,
    /^\S+@\S+\.\S+$/.test(email) ? supabase.from("customers").select("id").eq("email", email).is("archived_at", null).limit(5) : null,
    input.address.trim().length >= 5 ? supabase.from("properties").select("customer_id").eq("address_key", addressKey).limit(5) : null,
  ]);
  for (const row of byPhone?.data ?? []) add(row.id, "phone");
  for (const row of byEmail?.data ?? []) add(row.id, "email");
  for (const row of byAddress?.data ?? []) add(row.customer_id, "address");
  if (reasons.size === 0) return [];

  const { data: customers } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone, email, properties(address_line1), opportunities(id, title, stage)")
    .in("id", [...reasons.keys()]);

  return (customers ?? []).map((c) => ({
    customerId: c.id,
    name: `${c.first_name} ${c.last_name}`.trim(),
    phone: c.phone,
    email: c.email,
    matchedOn: [...(reasons.get(c.id) ?? [])],
    addresses: c.properties.map((p) => p.address_line1),
    openDeals: c.opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost").map((o) => ({ id: o.id, title: o.title })),
  }));
}

export async function logContact(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = logContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const result = unwrapRpc(
    await supabase.rpc("log_contact", {
      p_opportunity_id: parsed.data.opportunity_id,
      p_type: parsed.data.type,
      p_outcome: parsed.data.outcome,
      p_summary: parsed.data.summary,
    }),
  );
  if (!result.ok) return result;
  const customerId = formData.get("customer_id");
  revalidateDeal(typeof customerId === "string" ? customerId : undefined);
  return ok();
}

export async function assignOwner(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = assignOwnerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Choose an owner");

  const supabase = await createClient();
  const result = unwrapRpc(
    await supabase.rpc("assign_owner", { p_opportunity_id: parsed.data.opportunity_id, p_owner_id: parsed.data.owner_id }),
  );
  if (!result.ok) return result;
  const customerId = formData.get("customer_id");
  revalidateDeal(typeof customerId === "string" ? customerId : undefined);
  return ok();
}
