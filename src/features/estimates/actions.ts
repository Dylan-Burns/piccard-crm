"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { priceBookItemSchema, saveLinesSchema, updateEstimateSchema } from "@/features/estimates/schemas";
import { currentProfileWithRole } from "@/lib/auth";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { unwrapRpc, type RpcResult } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");
const LOCKED = fail("locked", "This estimate has been sent and can no longer be edited");

function revalidate(opportunityId: string, estimateId?: string) {
  revalidatePath(`/opportunities/${opportunityId}`);
  if (estimateId) revalidatePath(`/opportunities/${opportunityId}/estimates/${estimateId}`);
  revalidatePath("/customers", "layout");
  revalidatePath("/pipeline");
}

/** New draft with the company's current tax rate, deposit, terms, and validity (`create_estimate`). */
export async function createEstimate(input: unknown): Promise<ActionResult<{ estimateId: string }>> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const parsed = z.object({ opportunityId: z.uuid(), title: z.string().trim().max(200).optional() }).safeParse(input);
  if (!parsed.success) return fail("invalid", "Unknown deal");
  const supabase = await createClient();
  const result = unwrapRpc<RpcResult & { estimate_id: string }>(
    await supabase.rpc("create_estimate", { p_opportunity_id: parsed.data.opportunityId, p_title: parsed.data.title || undefined }),
  );
  if (!result.ok) return result;
  revalidate(parsed.data.opportunityId);
  return ok({ estimateId: result.data.estimate_id });
}

/** Header fields of a draft. The database refuses edits once the estimate has left draft. */
export async function updateEstimate(input: unknown): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const parsed = updateEstimateSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { id, discount, tax_percent, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .update({ ...rest, discount_cents: discount, tax_rate: tax_percent })
    .eq("id", id)
    .select("opportunity_id");
  if (error) {
    if (error.code === "42501") return NOT_ALLOWED;
    return error.hint === "estimate_locked" ? LOCKED : fail("update_failed", "Could not save the estimate");
  }
  if (data.length === 0) return fail("not_found", "Estimate not found");
  revalidate(data[0]!.opportunity_id, id);
  return ok();
}

/** Replaces a draft's lines in one transaction (`save_estimate_lines`); the trigger recalculates totals. */
export async function saveEstimateLines(input: unknown): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const parsed = saveLinesSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the lines");
  const lines = parsed.data.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity.toFixed(2), unit: l.unit, unit_price_cents: l.unitPriceCents, is_taxable: l.isTaxable }));
  const supabase = await createClient();
  const result = unwrapRpc<RpcResult>(await supabase.rpc("save_estimate_lines", { p_estimate_id: parsed.data.estimateId, p_lines: lines as Json }));
  if (!result.ok) return result;
  const { data } = await supabase.from("estimates").select("opportunity_id").eq("id", parsed.data.estimateId).maybeSingle();
  if (data) revalidate(data.opportunity_id, parsed.data.estimateId);
  return ok();
}

export async function voidEstimate(input: unknown): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const parsed = z.object({ estimateId: z.uuid(), opportunityId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("invalid", "Unknown estimate");
  const supabase = await createClient();
  const result = unwrapRpc<RpcResult>(await supabase.rpc("void_estimate", { p_estimate_id: parsed.data.estimateId }));
  if (!result.ok) return result;
  revalidate(parsed.data.opportunityId, parsed.data.estimateId);
  return ok();
}

// ---------------------------------------------------------------------------
// Price book (admin). Estimates copy values from it, so edits never change an existing estimate.
// ---------------------------------------------------------------------------

export async function addPriceBookItem(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const parsed = priceBookItemSchema.safeParse({ is_taxable: "", ...Object.fromEntries(formData) });
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { price, ...rest } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("price_book_items").insert({ ...rest, unit_price_cents: price });
  if (error) return error.code === "42501" ? NOT_ALLOWED : fail("insert_failed", "Could not add the item");
  revalidatePath("/settings/price-book");
  return ok();
}

export async function updatePriceBookItem(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return fail("invalid", "Unknown item");
  const supabase = await createClient();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const { error } = await supabase.from("price_book_items").delete().eq("id", id.data);
    if (error) return error.code === "42501" ? NOT_ALLOWED : fail("delete_failed", "Could not delete the item");
  } else if (intent === "activate" || intent === "deactivate") {
    const { error } = await supabase.from("price_book_items").update({ is_active: intent === "activate" }).eq("id", id.data);
    if (error) return error.code === "42501" ? NOT_ALLOWED : fail("update_failed", "Could not save the item");
  } else {
    const parsed = priceBookItemSchema.safeParse({ is_taxable: "", ...Object.fromEntries(formData) });
    if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
    const { price, ...rest } = parsed.data;
    const { error } = await supabase.from("price_book_items").update({ ...rest, unit_price_cents: price }).eq("id", id.data);
    if (error) return error.code === "42501" ? NOT_ALLOWED : fail("update_failed", "Could not save the item");
  }
  revalidatePath("/settings/price-book");
  return ok();
}
