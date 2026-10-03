import { after, NextResponse, type NextRequest } from "next/server";
import { clientIp, processSubmission, receiveLead, secretsMatch } from "@/features/leads/ingest";
import { serverEnv } from "@/lib/env";

/**
 * Website lead webhook (spec §6.5). Called server-to-server by the website's backend with
 * X-Webhook-Secret. The secret must never be placed in browser code.
 */
export async function POST(request: NextRequest) {
  if (!secretsMatch(request.headers.get("x-webhook-secret"), serverEnv().LEAD_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await receiveLead("website", await request.text(), clientIp(request.headers));
  if (result.submissionId) {
    const id = result.submissionId;
    after(() => processSubmission(id));
  }
  return NextResponse.json(result.body, { status: result.status });
}
