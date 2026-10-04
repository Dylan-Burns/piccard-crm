import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentProfileWithRole } from "@/lib/auth";
import { resolveOrigin } from "@/lib/env";
import { encrypt } from "@/lib/integrations/crypto";
import { createCrmCalendar, enqueueAppointments, exchangeCode } from "@/lib/integrations/google-calendar";
import { createAdminClient } from "@/lib/supabase/admin";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The account email from Google's id token. The token came straight from Google over TLS, so its payload is read without re-verifying the signature. */
function emailFrom(idToken: string | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1]!, "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Finishes the Google sign-in: checks `state`, exchanges the code, creates the shared CRM calendar
 * on first connect, and stores the tokens encrypted. Then queues upcoming appointments.
 */
export async function GET(request: Request) {
  const origin = resolveOrigin(request.headers.get("x-forwarded-host") ?? request.headers.get("host"), request.headers.get("x-forwarded-proto"));
  const settings = `${origin}/settings/integrations`;
  const done = (result: string) => {
    const response = NextResponse.redirect(`${settings}?google=${result}`);
    response.cookies.delete({ name: "google_oauth_state", path: "/api/integrations/google" });
    return response;
  };

  const me = await currentProfileWithRole("admin");
  if (!me) return NextResponse.redirect(`${origin}/login`);
  const query = new URL(request.url).searchParams;
  const expected = (await cookies()).get("google_oauth_state")?.value;
  const state = query.get("state");
  const code = query.get("code");
  if (query.get("error")) return done("cancelled");
  if (!expected || !state || !same(state, expected) || !code) return done("error");

  try {
    const tokens = await exchangeCode(code, `${origin}/api/integrations/google/callback`);
    if (!tokens.refresh_token) return done("no_refresh_token");

    const db = createAdminClient();
    const [{ data: existing }, { data: settingsRow }] = await Promise.all([
      db.from("integration_connections").select("config").eq("provider", "google_calendar").maybeSingle(),
      db.from("company_settings").select("company_name, timezone").maybeSingle(),
    ]);
    const config = (existing?.config ?? {}) as { calendar_id?: string; calendar_name?: string };
    const calendarName = `${settingsRow?.company_name ?? "Company"} CRM`;
    // Keep the calendar from an earlier connection, so reconnecting does not create a second one.
    const calendarId = config.calendar_id ?? (await createCrmCalendar(tokens.access_token, settingsRow?.company_name ?? "Company", settingsRow?.timezone ?? "America/New_York"));

    const { error } = await db.from("integration_connections").upsert({
      provider: "google_calendar",
      status: "connected",
      access_token_enc: encrypt(tokens.access_token),
      refresh_token_enc: encrypt(tokens.refresh_token),
      expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      external_account_id: emailFrom(tokens.id_token),
      config: { calendar_id: calendarId, calendar_name: config.calendar_name ?? calendarName },
      last_error: null,
      connected_by: me.id,
    });
    if (error) return done("error");
    // Anything scheduled while disconnected (or before the first connect) is sent now.
    await enqueueAppointments(null);
    return done("connected");
  } catch (error) {
    console.error("Google connect failed", error);
    return done("error");
  }
}
