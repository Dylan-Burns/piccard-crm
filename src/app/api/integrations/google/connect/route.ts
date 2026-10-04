import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentProfileWithRole } from "@/lib/auth";
import { resolveOrigin, serverEnv } from "@/lib/env";
import { GOOGLE_SCOPES } from "@/lib/integrations/google-calendar";

/**
 * Starts the Google sign-in (spec §6.1, §6.2). Admin only. The random `state` is kept in an
 * HttpOnly cookie and compared in the callback, so the response cannot be forged by another site.
 */
export async function GET(request: Request) {
  const origin = resolveOrigin(request.headers.get("x-forwarded-host") ?? request.headers.get("host"), request.headers.get("x-forwarded-proto"));
  const settings = `${origin}/settings/integrations`;
  if (!(await currentProfileWithRole("admin"))) return NextResponse.redirect(`${origin}/login`);
  const env = serverEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.INTEGRATION_ENCRYPTION_KEY) return NextResponse.redirect(`${settings}?google=not_configured`);

  const state = randomBytes(24).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/integrations/google/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline", // a refresh token
    prompt: "consent", // always, so Google issues the refresh token again on a reconnect
    state,
  }).toString();

  const response = NextResponse.redirect(url);
  response.cookies.set("google_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/api/integrations/google", maxAge: 600 });
  return response;
}
