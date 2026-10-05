import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentProfileWithRole } from "@/lib/auth";
import { resolveOrigin, serverEnv } from "@/lib/env";
import { QBO_AUTHORIZE_URL, QBO_SCOPE } from "@/lib/integrations/quickbooks";

/** Starts the Intuit sign-in (spec §6.1, §6.3). Admin only; `state` is checked in the callback. */
export async function GET(request: Request) {
  const origin = resolveOrigin(request.headers.get("x-forwarded-host") ?? request.headers.get("host"), request.headers.get("x-forwarded-proto"));
  const settings = `${origin}/settings/integrations`;
  if (!(await currentProfileWithRole("admin"))) return NextResponse.redirect(`${origin}/login`);
  const env = serverEnv();
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET || !env.INTEGRATION_ENCRYPTION_KEY) return NextResponse.redirect(`${settings}?quickbooks=not_configured`);

  const state = randomBytes(24).toString("base64url");
  const url = new URL(QBO_AUTHORIZE_URL);
  url.search = new URLSearchParams({ client_id: env.QBO_CLIENT_ID, redirect_uri: `${origin}/api/integrations/quickbooks/callback`, response_type: "code", scope: QBO_SCOPE, state }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set("qbo_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/api/integrations/quickbooks", maxAge: 600 });
  return response;
}
