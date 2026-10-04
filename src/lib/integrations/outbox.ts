import "server-only";
import { ConnectionError, syncAppointment, type Fetch } from "@/lib/integrations/google-calendar";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type OutboxRow = Database["public"]["Tables"]["sync_outbox"]["Row"];
type Handler = (row: OutboxRow, fetchImpl: Fetch) => Promise<unknown>;

/** One handler per provider. QuickBooks is added in Phase 13. */
const HANDLERS: Partial<Record<OutboxRow["provider"], Handler>> = {
  google_calendar: (row, fetchImpl) => syncAppointment(row.entity_id, fetchImpl),
};

export type OutboxResult = { claimed: number; done: number; retried: number; failed: number; held: number };

/**
 * Drains the sync outbox (spec §6.1): claim a batch, sync each entity's current state, then mark
 * it done or schedule a retry. Runs right after user actions and from cron as the safety net.
 * Never throws: an integration failure must not fail the action that queued it (rule 17).
 */
export async function processOutbox(fetchImpl: Fetch = fetch, limit = 20): Promise<OutboxResult> {
  const result: OutboxResult = { claimed: 0, done: 0, retried: 0, failed: 0, held: 0 };
  try {
    const db = createAdminClient();
    const { data: rows, error } = await db.rpc("claim_outbox_batch", { p_limit: limit });
    if (error || !rows) return result;
    result.claimed = rows.length;
    let connectionDown = false;

    for (const row of rows) {
      const handler = HANDLERS[row.provider];
      try {
        // Once the connection is known to be down, do not hammer it for the rest of the batch.
        if (connectionDown) throw new ConnectionError("Google Calendar needs to be reconnected");
        if (!handler) throw new Error(`No handler for ${row.provider}`);
        await handler(row, fetchImpl);
        await db.rpc("complete_outbox", { p_id: row.id });
        result.done += 1;
      } catch (error) {
        const hold = error instanceof ConnectionError;
        if (hold) connectionDown = true;
        const { data: outcome } = await db.rpc("fail_outbox", { p_id: row.id, p_error: error instanceof Error ? error.message : String(error), p_hold: hold });
        if (outcome === "failed") result.failed += 1;
        else if (outcome === "held") result.held += 1;
        else result.retried += 1;
      }
    }
  } catch (error) {
    console.error("processOutbox failed", error);
  }
  return result;
}
