"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WORK_TYPES } from "@/features/leads/schemas";
import { currentProfileWithRole } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/money";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");
const blankToNull = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v));
const money = z.string().trim().transform((v, ctx) => {
  if (v === "") return null;
  const cents = parseDollarsToCents(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 24,800" });
    return z.NEVER;
  }
  return cents;
});

const dealSchema = z.object({
  opportunity_id: z.uuid(),
  title: z.string().trim().min(1, "Enter a title").max(200),
  work_type: z.union([z.literal(""), z.enum(WORK_TYPES)]).transform((v) => v || null),
  property_id: z.union([z.literal(""), z.uuid()]).transform((v) => v || null),
  source_id: z.union([z.literal(""), z.uuid()]).transform((v) => v || null),
  estimated_value: money,
  description: blankToNull(4000),
  is_insurance_claim: z.union([z.literal("on"), z.literal("")]).optional().transform((v) => v === "on"),
  insurance_carrier: blankToNull(120),
  claim_number: blankToNull(80),
  adjuster_name: blankToNull(120),
  adjuster_phone: blankToNull(40),
  deductible: money,
});

/** Edits a deal's descriptive fields: only the columns users may write directly (spec §2.10). */
export async function updateOpportunity(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = dealSchema.safeParse({ is_insurance_claim: "", ...Object.fromEntries(formData) });
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { opportunity_id, estimated_value, deductible, ...rest } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opportunities")
    .update({ ...rest, estimated_value_cents: estimated_value, deductible_cents: deductible })
    .eq("id", opportunity_id)
    .select("customer_id")
    .maybeSingle();
  if (error || !data) return fail("update_failed", "Could not save the deal");

  revalidatePath(`/opportunities/${opportunity_id}`);
  revalidatePath(`/customers/${data.customer_id}`);
  revalidatePath("/pipeline");
  revalidatePath("/leads");
  return ok();
}

/** Dismisses the "possible duplicate" banner (spec §6.5 "Keep both"). */
export async function keepBothDeals(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const id = z.uuid().safeParse(formData.get("opportunity_id"));
  if (!id.success) return fail("invalid", "Invalid deal");
  const supabase = await createClient();
  const { error } = await supabase.from("opportunities").update({ possible_duplicate_of: null }).eq("id", id.data);
  if (error) return fail("update_failed", "Could not update the deal");
  revalidatePath(`/opportunities/${id.data}`);
  return ok();
}

const dealMetaSchema = z.object({
  id: z.uuid(),
  labels: z
    .array(z.string().trim().min(1).max(30))
    .max(10)
    .refine((l) => new Set(l.map((x) => x.toLowerCase())).size === l.length, "Labels must be different")
    .optional(),
  expectedCloseOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional(),
});

/** Labels and expected close date, saved from the deal's summary. One write. */
export async function updateDealMeta(input: unknown): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const parsed = dealMetaSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Labels can be up to 30 characters, 10 per deal");
  const { id, labels, expectedCloseOn } = parsed.data;
  const values = { ...(labels ? { labels } : {}), ...(expectedCloseOn !== undefined ? { expected_close_on: expectedCloseOn } : {}) };
  if (Object.keys(values).length === 0) return ok();
  const supabase = await createClient();
  const { data, error } = await supabase.from("opportunities").update(values).eq("id", id).select("id");
  if (error || data.length === 0) return fail("update_failed", "Could not save the deal");
  revalidatePath(`/opportunities/${id}`);
  revalidatePath("/pipeline");
  return ok();
}
