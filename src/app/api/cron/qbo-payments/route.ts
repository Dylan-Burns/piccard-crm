import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { pullPayments } from "@/lib/integrations/quickbooks";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Payment check (spec §6.3): what has been paid in QuickBooks on invoices the CRM is waiting on.
 * Does nothing when QuickBooks is not connected. Safe to run by hand or repeatedly.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data: connection } = await createAdminClient().from("integration_connections").select("status").eq("provider", "quickbooks").maybeSingle();
  if (connection?.status !== "connected") return NextResponse.json({ ok: true, skipped: "QuickBooks is not connected" });
  try {
    return NextResponse.json({ ok: true, ...(await pullPayments()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "failed" }, { status: 500 });
  }
}
