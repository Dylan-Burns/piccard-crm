import { NextResponse } from "next/server";
import { retryLeadSubmissions } from "@/features/leads/ingest";
import { isAuthorizedCron } from "@/lib/cron";
import { processOutbox } from "@/lib/integrations/outbox";
import { retryEmails } from "@/lib/integrations/resend";

/**
 * Safety net for work that normally finishes right after the request that caused it:
 * unprocessed lead submissions, unsent emails, and queued calendar syncs.
 * Safe to call by hand: `curl -H "Authorization: Bearer $CRON_SECRET" <app>/api/cron/process-outbox`.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const leads = await retryLeadSubmissions();
  const emails = await retryEmails();
  const outbox = await processOutbox(fetch, 100);
  return NextResponse.json({ ok: true, leads, emails, outbox });
}
