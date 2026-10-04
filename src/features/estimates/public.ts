import "server-only";
import { loadEstimateDocumentData, type EstimateDocumentData } from "@/features/estimates/pdf/data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The customer-facing estimate page has no signed-in user: whoever holds the estimate's
 * unguessable token may see that one estimate. Everything here uses the service client
 * (CLAUDE.md rule 4) and is keyed by the token only.
 */

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isToken = (value: string) => TOKEN.test(value);

export type PublicEstimate = { id: string; opportunityId: string; state: "open" | "accepted" | "declined" | "unavailable"; acceptedName: string | null; hasPdf: boolean; data: EstimateDocumentData };

/** The estimate for a token, or null when there is none (a draft is treated as not existing yet). */
export async function loadPublicEstimate(token: string): Promise<PublicEstimate | null> {
  if (!isToken(token)) return null;
  const db = createAdminClient();
  const { data: row } = await db.from("estimates").select("id, opportunity_id, status, accepted_name, pdf_path, valid_until").eq("public_token", token).maybeSingle();
  if (!row || row.status === "draft") return null;
  const data = await loadEstimateDocumentData(db, row.id);
  if (!data) return null;
  const state = row.status === "accepted" ? "accepted" : row.status === "declined" ? "declined" : row.status === "sent" || row.status === "viewed" ? "open" : "unavailable";
  return { id: row.id, opportunityId: row.opportunity_id, state, acceptedName: row.accepted_name, hasPdf: Boolean(row.pdf_path), data };
}

/** Headers for every public estimate response: never cached, never indexed (spec §7.4). */
export const PUBLIC_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;
