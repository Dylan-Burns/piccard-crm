import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { isEmailProvider } from "@/features/email/providers";
import { currentProfileWithRole } from "@/lib/auth";
import { resolveOrigin } from "@/lib/env";
import { encrypt } from "@/lib/integrations/crypto";
import { PROVIDERS, syncAccount } from "@/lib/integrations/email/mailbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Finishes linking a mailbox: checks `state`, exchanges the code (which is what proves the user
 * owns the address), and saves the encrypted tokens for the signed-in user. Then starts the first sync.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const origin = resolveOrigin(request.headers.get("x-forwarded-host") ?? request.headers.get("host"), request.headers.get("x-forwarded-proto"));
  const done = (result: string) => {
    const response = NextResponse.redirect(`${origin}/settings/profile?email=${result}`);
    response.cookies.delete({ name: "email_oauth_state", path: "/api/integrations/email" });
    return response;
  };
  const { provider } = await params;
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NextResponse.redirect(`${origin}/login`);
  if (!isEmailProvider(provider)) return done("error");

  const query = new URL(request.url).searchParams;
  const expected = (await cookies()).get("email_oauth_state")?.value;
  const state = query.get("state");
  const code = query.get("code");
  if (query.get("error")) return done("cancelled");
  if (!expected || !state || !code || !same(`${provider}:${state}`, expected)) return done("error");

  try {
    const tokens = await PROVIDERS[provider].exchange(code, `${origin}/api/integrations/email/${provider}/callback`, fetch);
    if (!tokens.refreshToken) return done("no_refresh_token");
    // Service role: only the server, having just completed the provider's sign-in for this user,
    // may record a linked mailbox (users cannot call this themselves).
    const { data, error } = await createAdminClient().rpc("save_email_account", {
      p_user_id: me.id,
      p_provider: provider,
      p_email: tokens.email,
      p_access_token_enc: encrypt(tokens.accessToken),
      p_refresh_token_enc: encrypt(tokens.refreshToken),
      p_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    });
    const saved = data as { ok?: boolean; code?: string } | null;
    if (error || !saved?.ok) return done(saved?.code === "in_use" ? "in_use" : "error");

    const supabase = await createClient();
    const { data: account } = await supabase.from("email_accounts").select("id").eq("user_id", me.id).maybeSingle();
    if (account) after(() => syncAccount(account.id));
    return done("linked");
  } catch (error) {
    console.error("Mailbox link failed", error);
    return done("error");
  }
}
