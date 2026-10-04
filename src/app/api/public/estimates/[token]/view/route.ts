import { NextResponse } from "next/server";
import { isToken, PUBLIC_HEADERS } from "@/features/estimates/public";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Called by the estimate page's script once the page has really been looked at. Only the first
 * view of a sent estimate changes anything; every other call is a no-op with the same answer.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (isToken(token)) await createAdminClient().rpc("record_estimate_view", { p_token: token });
  return NextResponse.json({ ok: true }, { headers: PUBLIC_HEADERS });
}
