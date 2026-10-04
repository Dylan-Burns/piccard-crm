import { NextResponse } from "next/server";
import { retryLeadSubmissions } from "@/features/leads/ingest";
import { isAuthorizedCron } from "@/lib/cron";
import { retryEmails } from "@/lib/integrations/resend";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Nightly: expire estimates past their valid-until date, give every open deal with no next step
 * a task (spec §4.4), then retry stuck lead submissions and unsent emails. Safe to run by hand
 * or twice: `curl -H "Authorization: Bearer $CRON_SECRET" <app>/api/cron/nightly`.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data, error } = await createAdminClient().rpc("run_nightly_maintenance");
  const leads = await retryLeadSubmissions();
  const emails = await retryEmails();
  return NextResponse.json({ ok: !error, maintenance: error ? { error: error.message } : data, leads, emails }, { status: error ? 500 : 200 });
}
