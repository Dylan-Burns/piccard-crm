"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentProfileWithRole } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/money";
import { toE164 } from "@/lib/phone";
import { fail, ok, type ActionResult } from "@/lib/result";
import { unwrapRpc, type RpcResult } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");
const OPEN = ["new", "contacted", "qualified", "inspection_scheduled", "estimate_sent", "negotiation"] as const;

function revalidateDeal(opportunityId: string, customerId?: string | null) {
  revalidatePath("/pipeline");
  revalidatePath("/leads");
  revalidatePath("/tasks");
  revalidatePath(`/opportunities/${opportunityId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

const fillSchema = z
  .object({
    owner_id: z.string().optional(),
    work_type: z.string().optional(),
    address_line1: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(50).optional(),
    postal_code: z.string().trim().max(20).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.union([z.literal(""), z.email()]).optional(),
  })
  .default({});

const moveSchema = z.object({
  opportunityId: z.uuid(),
  customerId: z.uuid().nullish(),
  toStage: z.enum(OPEN),
  fill: fillSchema,
});

/** Moves a deal between open stages. A gate failure returns code `missing_requirements` with the missing names as `fields` keys. */
export async function moveStage(input: z.input<typeof moveSchema>): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the highlighted fields");
  const { opportunityId, customerId, toStage, fill } = parsed.data;

  const supabase = await createClient();
  const result = unwrapRpc(
    await supabase.rpc("change_opportunity_stage", {
      p_opportunity_id: opportunityId,
      p_to_stage: toStage,
      p_fill: { ...fill, phone_e164: toE164(fill.phone) ?? "" },
    }),
  );
  revalidateDeal(opportunityId, customerId); // fills are saved even when the move is refused
  return result.ok ? ok() : result;
}

const wonSchema = z.object({
  opportunityId: z.uuid(),
  customerId: z.uuid().nullish(),
  estimateId: z.uuid().nullish(),
  amount: z.string().optional(),
});

export async function markWon(input: z.input<typeof wonSchema>): Promise<ActionResult<{ jobNumber: number }>> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = wonSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the highlighted fields");
  const { opportunityId, customerId, estimateId, amount } = parsed.data;

  let cents: number | null = null;
  if (!estimateId) {
    cents = parseDollarsToCents(amount);
    if (!cents || cents <= 0) return fail("invalid", "Enter the contract amount", { amount: "Enter an amount like 24,800" });
  }

  const supabase = await createClient();
  const result = unwrapRpc<RpcResult & { job_number: number }>(
    await supabase.rpc("mark_opportunity_won", {
      p_opportunity_id: opportunityId,
      ...(estimateId ? { p_estimate_id: estimateId } : {}),
      ...(cents ? { p_amount_cents: cents } : {}),
    }),
  );
  if (!result.ok) return result;
  revalidateDeal(opportunityId, customerId);
  revalidatePath("/jobs");
  return ok({ jobNumber: result.data.job_number });
}

const lostSchema = z.object({
  opportunityId: z.uuid(),
  customerId: z.uuid().nullish(),
  reason: z.enum(["price", "competitor", "no_response", "not_qualified", "insurance_denied", "timing", "duplicate", "other"]),
  notes: z.string().trim().max(2000).optional(),
  competitor: z.string().trim().max(120).optional(),
});

export async function markLost(input: z.input<typeof lostSchema>): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = lostSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Choose a reason", { reason: "Choose a reason" });
  const { opportunityId, customerId, reason, notes, competitor } = parsed.data;

  const supabase = await createClient();
  const result = unwrapRpc(
    await supabase.rpc("mark_opportunity_lost", {
      p_opportunity_id: opportunityId,
      p_reason: reason,
      p_notes: notes ?? "",
      p_competitor: competitor ?? "",
    }),
  );
  if (!result.ok) return result.error.code === "notes_required" ? fail("invalid", result.error.message, { notes: result.error.message }) : result;
  revalidateDeal(opportunityId, customerId);
  return ok();
}

const reopenSchema = z.object({ opportunityId: z.uuid(), customerId: z.uuid().nullish(), toStage: z.enum(OPEN) });

export async function reopenDeal(input: z.input<typeof reopenSchema>): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Choose a stage");
  const supabase = await createClient();
  const result = unwrapRpc(
    await supabase.rpc("reopen_opportunity", { p_opportunity_id: parsed.data.opportunityId, p_to_stage: parsed.data.toStage }),
  );
  if (!result.ok) return result;
  revalidateDeal(parsed.data.opportunityId, parsed.data.customerId);
  return ok();
}
