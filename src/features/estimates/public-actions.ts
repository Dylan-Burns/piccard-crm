"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { notifyDealWon, notifyEstimateDecision } from "@/features/estimates/notify";
import { isToken } from "@/features/estimates/public";
import { fail, ok, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Approve and decline from the public estimate page. No session: the token is the credential,
 * and both are idempotent state changes guarded inside the RPCs.
 */

const approveSchema = z.object({
  token: z.string().refine(isToken),
  name: z.string().trim().min(2, "Type your full name").max(200),
  agree: z.literal("on", { error: "Tick the box to approve" }),
});

type RpcShape = { ok: boolean; code?: string; message?: string; already?: boolean; opportunity_id?: string; estimate_id?: string };

export async function approveEstimate(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = approveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the form");
  const forwarded = (await headers()).get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || null;

  const { data, error } = await createAdminClient().rpc("accept_estimate", { p_token: parsed.data.token, p_name: parsed.data.name, p_ip: ip ?? undefined });
  const result = data as RpcShape | null;
  if (error || !result) return fail("failed", "Something went wrong. Please try again, or call us.");
  if (!result.ok) return fail(result.code ?? "failed", result.code === "name_required" ? "Type your full name" : "This estimate can no longer be approved online. Please call us.");

  if (!result.already && result.estimate_id && result.opportunity_id) {
    const { estimate_id, opportunity_id } = result;
    after(async () => {
      await notifyEstimateDecision(estimate_id, "approved");
      await notifyDealWon(opportunity_id);
    });
  }
  revalidatePath(`/e/${parsed.data.token}`);
  return ok();
}

const declineSchema = z.object({ token: z.string().refine(isToken), reason: z.string().trim().max(1000).optional() });

export async function declineEstimate(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = declineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the form");
  const { data, error } = await createAdminClient().rpc("decline_estimate", { p_token: parsed.data.token, p_reason: parsed.data.reason || undefined });
  const result = data as RpcShape | null;
  if (error || !result) return fail("failed", "Something went wrong. Please try again, or call us.");
  if (!result.ok) return fail(result.code ?? "failed", "This estimate is no longer open. Please call us.");
  if (!result.already && result.estimate_id) {
    const { estimate_id } = result;
    after(() => notifyEstimateDecision(estimate_id, "declined"));
  }
  revalidatePath(`/e/${parsed.data.token}`);
  return ok();
}
