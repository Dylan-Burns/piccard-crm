import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Whether QuickBooks is connected and has its income item chosen. Connection status is
 * service-role data; callers must be admin-gated (CLAUDE.md rule 4).
 */
export async function quickbooksReadyForInvoices(): Promise<boolean> {
  const { data } = await createAdminClient().from("integration_connections").select("status, config").eq("provider", "quickbooks").maybeSingle();
  return data?.status === "connected" && Boolean((data.config as { item_id?: string } | null)?.item_id);
}
