import { after, NextResponse, type NextRequest } from "next/server";
import { clientIp, processSubmission, receiveLead, secretsMatch } from "@/features/leads/ingest";
import { serverEnv } from "@/lib/env";

/** Google Ads lead form webhook (spec §6.5). Google sends its key in the body as `google_key`. */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  let key: unknown;
  try {
    key = (JSON.parse(raw) as { google_key?: unknown }).google_key;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be a JSON object" }, { status: 400 });
  }
  if (!secretsMatch(typeof key === "string" ? key : null, serverEnv().GOOGLE_ADS_WEBHOOK_KEY)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await receiveLead("google_ads", raw, clientIp(request.headers));
  if (result.submissionId) {
    const id = result.submissionId;
    after(() => processSubmission(id));
  }
  return NextResponse.json(result.body, { status: result.status });
}
