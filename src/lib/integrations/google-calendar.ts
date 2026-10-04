import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { WORK_TYPE_LABELS } from "@/lib/deal-status";
import { appUrl, serverEnv } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/integrations/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

/**
 * Google Calendar, one way: CRM → Google (spec §6.2). REST with `fetch`, no SDK. The CRM is the
 * source of truth, and it supplies the event id (the appointment id without dashes), so a retry
 * can never create a second event.
 */

const API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar openid email";

export type Fetch = typeof fetch;
type Db = ReturnType<typeof createAdminClient>;

/** The connection itself is broken (revoked, expired): hold the queue and tell an admin. */
export class ConnectionError extends Error {}
/** Worth trying again later (rate limit, server error, network). */
export class RetryableError extends Error {}

const TYPE_LABELS: Record<Database["public"]["Enums"]["appointment_type"], string> = {
  inspection: "Inspection",
  estimate_presentation: "Estimate review",
  job_work: "Job",
  other: "Appointment",
};

export const eventIdFor = (appointmentId: string) => appointmentId.replaceAll("-", "");

async function markConnectionError(db: Db, message: string) {
  await db.from("integration_connections").update({ status: "error", last_error: message.slice(0, 500) }).eq("provider", "google_calendar");
}

/** Exchanges or refreshes tokens. Throws ConnectionError when Google says the grant is gone. */
async function tokenRequest(params: Record<string, string>, fetchImpl: Fetch) {
  const env = serverEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new ConnectionError("Google is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  }).catch(() => null);
  if (!response) throw new RetryableError("Could not reach Google");
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string };
  if (!response.ok || !body.access_token) {
    if (response.status >= 500) throw new RetryableError(`Google token endpoint returned ${response.status}`);
    throw new ConnectionError(body.error === "invalid_grant" ? "Google access was revoked or expired. Reconnect Google Calendar." : `Google refused the sign-in (${body.error ?? response.status})`);
  }
  return body as { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string };
}

export const exchangeCode = (code: string, redirectUri: string, fetchImpl: Fetch = fetch) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchImpl);

/**
 * A usable access token and the calendar id. Refreshes when fewer than five minutes remain, and
 * only one worker refreshes at a time (`lock_integration`); the others wait and re-read.
 */
export async function getValidAccessToken(fetchImpl: Fetch = fetch, db: Db = createAdminClient()): Promise<{ token: string; calendarId: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: connection } = await db.from("integration_connections").select("status, access_token_enc, refresh_token_enc, expires_at, config").eq("provider", "google_calendar").maybeSingle();
    if (!connection || connection.status === "disconnected") throw new ConnectionError("Google Calendar is not connected");
    if (connection.status === "error") throw new ConnectionError("Google Calendar needs to be reconnected");
    const calendarId = (connection.config as { calendar_id?: string } | null)?.calendar_id;
    if (!calendarId || !connection.access_token_enc || !connection.refresh_token_enc) throw new ConnectionError("Google Calendar is not fully connected. Reconnect it.");

    const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
    if (expiresAt - Date.now() > 5 * 60_000) return { token: decrypt(connection.access_token_enc), calendarId };

    const { data: gotLease } = await db.rpc("lock_integration", { p_provider: "google_calendar" });
    if (!gotLease) {
      // Someone else is refreshing: give them a moment, then read what they saved.
      await new Promise((resolve) => setTimeout(resolve, 750));
      continue;
    }
    try {
      const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(connection.refresh_token_enc) }, fetchImpl);
      await db
        .from("integration_connections")
        .update({
          access_token_enc: encrypt(refreshed.access_token),
          // Always keep a newly issued refresh token (spec §6.1).
          ...(refreshed.refresh_token ? { refresh_token_enc: encrypt(refreshed.refresh_token) } : {}),
          expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(),
          last_error: null,
        })
        .eq("provider", "google_calendar");
      return { token: refreshed.access_token, calendarId };
    } catch (error) {
      if (error instanceof ConnectionError) await markConnectionError(db, error.message);
      throw error;
    } finally {
      await db.rpc("unlock_integration", { p_provider: "google_calendar" });
    }
  }
  throw new RetryableError("Timed out waiting for the Google token to refresh");
}

async function loadAppointment(db: Db, id: string) {
  const { data } = await db
    .from("appointments")
    .select(
      `id, type, status, title, starts_at, ends_at, all_day, notes, opportunity_id, job_id,
       customer:customers!inner(first_name, last_name),
       property:properties(address_line1, city, state, postal_code, access_notes),
       assignee:profiles!appointments_assigned_to_fkey(email, is_active),
       opportunity:opportunities!inner(work_type)`,
    )
    .eq("id", id)
    .maybeSingle();
  return data;
}
type Appointment = NonNullable<Awaited<ReturnType<typeof loadAppointment>>>;

/** The event body (spec §6.2). No prices: the description is visible to whoever is invited. */
export function buildEvent(a: Appointment, timeZone: string) {
  const customer = `${a.customer.first_name} ${a.customer.last_name}`.trim();
  const workType = a.opportunity.work_type ? WORK_TYPE_LABELS[a.opportunity.work_type] : null;
  const summary = `${a.status === "completed" ? "✓ " : ""}${TYPE_LABELS[a.type]}: ${customer}${workType ? ` — ${workType}` : ""}`;
  const location = a.property ? [a.property.address_line1, a.property.city, a.property.state, a.property.postal_code].filter(Boolean).join(", ") : undefined;
  const link = a.job_id ? `${appUrl()}/jobs/${a.job_id}` : `${appUrl()}/opportunities/${a.opportunity_id}`;
  const description = [
    a.property?.access_notes ? `Access: ${a.property.access_notes}` : null,
    a.notes,
    link,
    "Managed by the CRM. Changes made in Google Calendar will be overwritten.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const day = (value: string) => formatInTimeZone(value, timeZone, "yyyy-MM-dd");
  return {
    id: eventIdFor(a.id),
    status: "confirmed", // also revives an event someone deleted in Google
    summary,
    location,
    description,
    start: a.all_day ? { date: day(a.starts_at) } : { dateTime: new Date(a.starts_at).toISOString(), timeZone },
    end: a.all_day ? { date: day(a.ends_at) } : { dateTime: new Date(a.ends_at).toISOString(), timeZone },
    attendees: a.assignee?.is_active && a.assignee.email ? [{ email: a.assignee.email }] : [],
    extendedProperties: { private: { crm_appointment_id: a.id } },
  };
}

async function call(fetchImpl: Fetch, token: string, method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!response) throw new RetryableError("Could not reach Google Calendar");
  return response;
}

/** Turns a failed response into the right kind of error (spec §6.2 "Failures"). */
async function fail(response: Response, db: Db): Promise<never> {
  const text = (await response.text().catch(() => "")).slice(0, 300);
  if (response.status === 401) {
    const message = "Google rejected the connection. Reconnect Google Calendar.";
    await markConnectionError(db, message);
    throw new ConnectionError(message);
  }
  if (response.status === 403 || response.status === 429 || response.status >= 500) throw new RetryableError(`Google Calendar returned ${response.status}`);
  throw new Error(`Google Calendar returned ${response.status}: ${text}`);
}

/**
 * Brings Google in line with one appointment's current state: scheduled or completed → create
 * or update; cancelled or no-show → delete. Safe to repeat.
 */
export async function syncAppointment(appointmentId: string, fetchImpl: Fetch = fetch, db: Db = createAdminClient()): Promise<"upserted" | "deleted" | "gone"> {
  const appointment = await loadAppointment(db, appointmentId);
  if (!appointment) return "gone"; // deleted in the CRM since it was queued
  const { token, calendarId } = await getValidAccessToken(fetchImpl, db);
  const calendar = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const eventId = eventIdFor(appointment.id);

  if (appointment.status === "cancelled" || appointment.status === "no_show") {
    const response = await call(fetchImpl, token, "DELETE", `${calendar}/${eventId}?sendUpdates=none`);
    // Already gone counts as done.
    if (!response.ok && response.status !== 404 && response.status !== 410) await fail(response, db);
    await db.from("appointments").update({ google_event_id: null, google_sync_status: "synced", google_synced_at: new Date().toISOString(), google_sync_error: null }).eq("id", appointment.id);
    return "deleted";
  }

  const { data: settings } = await db.from("company_settings").select("timezone").maybeSingle();
  const event = buildEvent(appointment, settings?.timezone ?? "America/New_York");
  let response = await call(fetchImpl, token, "POST", `${calendar}?sendUpdates=none`, event);
  if (response.status === 409) {
    // The id already exists (an earlier attempt, or a deleted event): update it instead.
    const { id: _id, ...patch } = event;
    response = await call(fetchImpl, token, "PATCH", `${calendar}/${eventId}?sendUpdates=none`, patch);
  }
  if (!response.ok) await fail(response, db);
  await db.from("appointments").update({ google_event_id: eventId, google_sync_status: "synced", google_synced_at: new Date().toISOString(), google_sync_error: null }).eq("id", appointment.id);
  return "upserted";
}

/** Creates the shared "{Company} CRM" calendar on first connect and returns its id. */
export async function createCrmCalendar(token: string, companyName: string, timeZone: string, fetchImpl: Fetch = fetch): Promise<string> {
  const response = await call(fetchImpl, token, "POST", "/calendars", { summary: `${companyName} CRM`, timeZone });
  const body = (await response.json().catch(() => ({}))) as { id?: string };
  if (!response.ok || !body.id) throw new Error(`Could not create the calendar (${response.status})`);
  return body.id;
}

/**
 * Queues appointments for syncing. With `days`, every scheduled appointment starting in that
 * window (the nightly re-assert, which also restores events deleted in Google); with null, every
 * future scheduled appointment (Backfill). `ids` queues exactly those (Retry). Returns how many
 * rows were added; an appointment that is already queued is not queued twice.
 */
export async function enqueueAppointments(days: number | null, ids?: string[], db: Db = createAdminClient()): Promise<number> {
  const { data, error } = await db.rpc("enqueue_appointment_syncs", { ...(days !== null ? { p_days: days } : {}), ...(ids ? { p_ids: ids } : {}) });
  if (error) throw new Error(error.message);
  return data ?? 0;
}
