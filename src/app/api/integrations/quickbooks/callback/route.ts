import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentProfileWithRole } from "@/lib/auth";
import { resolveOrigin, serverEnv } from "@/lib/env";
import { encrypt } from "@/lib/integrations/crypto";
import { exchangeQboCode, getQboCompanyName } from "@/lib/integrations/quickbooks";
import { createAdminClient } from "@/lib/supabase/admin";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Finishes the Intuit sign-in: checks `state`, exchanges the code, and stores the encrypted tokens
 * with the company id (realmId) and environment. The income item is chosen afterwards in Settings.
 */
export async function GET(request: Request) {
  const origin = resolveOrigin(request.headers.get("x-forwarded-host") ?? request.headers.get("host"), request.headers.get("x-forwarded-proto"));
  const done = (result: string) => {
    const response = NextResponse.redirect(`${origin}/settings/integrations?quickbooks=${result}`);
    response.cookies.delete({ name: "qbo_oauth_state", path: "/api/integrations/quickbooks" });
    return response;
  };
  const me = await currentProfileWithRole("admin");
  if (!me) return NextResponse.redirect(`${origin}/login`);
  const query = new URL(request.url).searchParams;
  const expected = (await cookies()).get("qbo_oauth_state")?.value;
  const state = query.get("state");
  const code = query.get("code");
  const realmId = query.get("realmId");
  if (query.get("error")) return done("cancelled");
  if (!expected || !state || !code || !realmId || !/^\d{1,30}$/.test(realmId) || !same(state, expected)) return done("error");

  try {
    const tokens = await exchangeQboCode(code, `${origin}/api/integrations/quickbooks/callback`);
    const db = createAdminClient();
    const { data: existing } = await db.from("integration_connections").select("external_account_id, config").eq("provider", "quickbooks").maybeSingle();
    // Keep the chosen item when reconnecting the same company; a different company starts again.
    const previous = existing?.external_account_id === realmId ? ((existing.config ?? {}) as Record<string, unknown>) : {};
    const { error } = await db.from("integration_connections").upsert({
      provider: "quickbooks",
      status: "connected",
      access_token_enc: encrypt(tokens.access_token),
      refresh_token_enc: encrypt(tokens.refresh_token),
      expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      external_account_id: realmId,
      config: { ...previous, environment: serverEnv().QBO_ENVIRONMENT ?? "sandbox" },
      last_error: null,
      connected_by: me.id,
    });
    if (error) return done("error");
    // Best effort: show which company was connected.
    const companyName = await getQboCompanyName().catch(() => null);
    if (companyName) {
      const { data: row } = await db.from("integration_connections").select("config").eq("provider", "quickbooks").single();
      await db.from("integration_connections").update({ config: { ...((row?.config ?? {}) as Record<string, unknown>), company_name: companyName } }).eq("provider", "quickbooks");
    }
    return done("connected");
  } catch (error) {
    console.error("QuickBooks connect failed", error);
    return done("error");
  }
}
