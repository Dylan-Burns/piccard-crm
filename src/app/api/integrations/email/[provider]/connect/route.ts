import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { emailProviderReady, isEmailProvider } from "@/features/email/providers";
import { currentProfileWithRole } from "@/lib/auth";
import { resolveOrigin } from "@/lib/env";
import { PROVIDERS } from "@/lib/integrations/email/mailbox";

/**
 * Starts linking the signed-in staff user's own mailbox (Google or Microsoft). The random `state`
 * is kept in an HttpOnly cookie and compared in the callback.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const origin = resolveOrigin(request.headers.get("x-forwarded-host") ?? request.headers.get("host"), request.headers.get("x-forwarded-proto"));
  const settings = `${origin}/settings/profile`;
  const { provider } = await params;
  if (!(await currentProfileWithRole("admin", "sales"))) return NextResponse.redirect(`${origin}/login`);
  if (!isEmailProvider(provider)) return NextResponse.redirect(`${settings}?email=error`);
  if (!emailProviderReady(provider)) return NextResponse.redirect(`${settings}?email=not_configured`);

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(PROVIDERS[provider].authUrl(`${origin}/api/integrations/email/${provider}/callback`, state));
  response.cookies.set("email_oauth_state", `${provider}:${state}`, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/api/integrations/email", maxAge: 600 });
  return response;
}
