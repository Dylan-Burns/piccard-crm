import { NextResponse } from "next/server";
import { retryLeadSubmissions } from "@/features/leads/ingest";
import { isAuthorizedCron } from "@/lib/cron";
import { enqueueAppointments } from "@/lib/integrations/google-calendar";
import { syncAllAccounts } from "@/lib/integrations/email/mailbox";
import { processOutbox } from "@/lib/integrations/outbox";
import { retryEmails } from "@/lib/integrations/resend";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Nightly: expire estimates past their valid-until date, give every open deal with no next step
 * a task (spec §4.4), retry stuck lead submissions and unsent emails, and re-assert the next 60
 * days of appointments on Google Calendar (which restores events deleted there). Safe to run by hand
 * or twice: `curl -H "Authorization: Bearer $CRON_SECRET" <app>/api/cron/nightly`.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data, error } = await createAdminClient().rpc("run_nightly_maintenance");
  const leads = await retryLeadSubmissions();
  const emails = await retryEmails();
  // Only when Google is connected; otherwise there is nothing to keep in step.
  const db = createAdminClient();
  const { data: google } = await db.from("integration_connections").select("status").eq("provider", "google_calendar").maybeSingle();
  const calendar = google?.status === "connected" ? { queued: await enqueueAppointments(60).catch(() => 0), ...(await processOutbox(fetch, 100)) } : null;
  const mailboxes = await syncAllAccounts();
  return NextResponse.json({ ok: !error, maintenance: error ? { error: error.message } : data, leads, emails, calendar, mailboxes }, { status: error ? 500 : 200 });
}
