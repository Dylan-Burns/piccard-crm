import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export function estimateLabel(e: { estimate_number: number; version: number }) {
  return `E-${e.estimate_number}${e.version > 1 ? `-v${e.version}` : ""}`;
}

const ESTIMATE_COLUMNS = `id, opportunity_id, estimate_number, version, status, title, scope_notes, terms, subtotal_cents, discount_cents,
  tax_rate, tax_cents, total_cents, deposit_percent, deposit_cents, valid_until, created_at, sent_at`;
const LINE_COLUMNS = "id, sort_order, name, description, quantity, unit, unit_price_cents, is_taxable, total_cents";

/** An estimate with its lines in order. Staff only (RLS). Takes a client so tests can call it. */
export async function loadEstimate(supabase: SupabaseClient<Database>, id: string) {
  const { data, error } = await supabase
    .from("estimates")
    .select(`${ESTIMATE_COLUMNS}, estimate_line_items(${LINE_COLUMNS})`)
    .eq("id", id)
    .order("sort_order", { referencedTable: "estimate_line_items" })
    .maybeSingle();
  if (error) throw error;
  return data;
}
export type EstimateWithLines = NonNullable<Awaited<ReturnType<typeof loadEstimate>>>;

export async function getEstimate(id: string) {
  return loadEstimate(await createClient(), id);
}

/** Every version of every estimate on a deal, newest first. */
export async function listEstimates(opportunityId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .select("id, estimate_number, version, status, title, total_cents, created_at, valid_until")
    .eq("opportunity_id", opportunityId)
    .order("estimate_number", { ascending: false })
    .order("version", { ascending: false });
  if (error) throw error;
  return data;
}

export async function listPriceBook(options: { activeOnly?: boolean } = {}) {
  const supabase = await createClient();
  let query = supabase.from("price_book_items").select("id, name, description, unit, unit_price_cents, is_taxable, is_active").order("name");
  if (options.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
export type PriceBookItem = Awaited<ReturnType<typeof listPriceBook>>[number];
