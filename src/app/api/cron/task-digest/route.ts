import { NextResponse } from "next/server";
import { sendTaskDigests } from "@/features/tasks/digest";
import { isAuthorizedCron } from "@/lib/cron";

/** Daily task digest. Safe to call more than once a day: each user gets at most one email per day. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await sendTaskDigests()) });
}
