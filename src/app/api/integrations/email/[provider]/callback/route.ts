import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { isEmailProvider } from "@/features/email/providers";
import { currentProfileWithRole } from "@/lib/auth";
import { resolveOrigin } from "@/lib/env";
import { encrypt } from "@/lib/integrations/crypto";
import { PROVIDERS, syncAccount } from "@/lib/integrations/email/mailbox";
import { createClient } from "@/lib/supabase/server";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Finishes linking a mailbox: checks `state`, exchanges the code, and saves the encrypted tokens
 * on the signed-in user's own row through `save_email_account` (the user-scoped client, so the
 * database decides whose mailbox it is). Then starts the first sync.
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
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_email_account", {
      p_provider: provider,
      p_email: tokens.email,
      p_access_token_enc: encrypt(tokens.accessToken),
      p_refresh_token_enc: encrypt(tokens.refreshToken),
      p_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    });
    if (error || !(data as { ok?: boolean } | null)?.ok) return done("error");

    const { data: account } = await supabase.from("email_accounts").select("id").eq("user_id", me.id).maybeSingle();
    if (account) after(() => syncAccount(account.id));
    return done("linked");
  } catch (error) {
    console.error("Mailbox link failed", error);
    return done("error");
  }
}
