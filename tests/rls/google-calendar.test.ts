import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Integration settings for this file only, set before anything reads the environment.
process.env.INTEGRATION_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";

import { decrypt, encrypt } from "@/lib/integrations/crypto";
import { enqueueAppointments, eventIdFor, type Fetch } from "@/lib/integrations/google-calendar";
import { processOutbox } from "@/lib/integrations/outbox";
import type { Json } from "@/types/database";
import { PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";

// Google Calendar sync with Google's API replaced by a fake `fetch` (spec §9 Phase 12, step 8).
const service = serviceClient();
let sales: Client;
let salesId: string, fieldId: string, fieldEmail: string;
const customers: string[] = [];
let seq = 0;

type Call = { method: string; url: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
/** A fake Google: `respond` decides the status (and body) for each request. */
function fakeGoogle(respond: (call: Call) => { status: number; body?: unknown }): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null;
    const call: Call = { method: init?.method ?? "GET", url: String(input), body: typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown> | null) };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers: { "Content-Type": "application/json" } });
  }) as Fetch;
}
const ok = fakeGoogle(() => ({ status: 200, body: { id: "x" } }));

async function connect(overrides: Record<string, unknown> = {}) {
  await service.from("integration_connections").upsert({
    provider: "google_calendar",
    status: "connected",
    access_token_enc: encrypt("access-1"),
    refresh_token_enc: encrypt("refresh-1"),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    external_account_id: "owner@example.com",
    config: { calendar_id: "cal_test" },
    last_error: null,
    ...overrides,
  });
}

async function appointment() {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Cal", last_name: `Sync${n}`, phone: `563${n}`, phone_e164: `+1309${n}`, address_line1: `${seq} Event Blvd`, city: "Springfield", postal_code: "62701", work_type: "roof_repair", owner_id: salesId } as Json,
  });
  const lead = data as { opportunity_id: string; customer_id: string };
  customers.push(lead.customer_id);
  const { data: scheduled, error } = await sales.rpc("schedule_appointment", {
    p: { opportunity_id: lead.opportunity_id, type: "inspection", starts_at: "2031-05-06T15:00:00Z", ends_at: "2031-05-06T16:00:00Z", assigned_to: fieldId, notes: "Bring the tall ladder" } as Json,
  });
  if (error) throw new Error(error.message);
  return { id: (scheduled as { appointment_id: string }).appointment_id, dealId: lead.opportunity_id, name: `Cal Sync${n}` };
}

const row = async (id: string) => (await service.from("appointments").select("google_event_id, google_sync_status, google_sync_error").eq("id", id).single()).data!;
const outbox = async (id: string) => (await service.from("sync_outbox").select("id, status, attempts, next_attempt_at, last_error").eq("entity_id", id).order("created_at")).data!;
/** Makes every pending row due now (backoff would otherwise make the test wait minutes). */
const makeDue = (id: string) => service.from("sync_outbox").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("entity_id", id).eq("status", "pending");

beforeAll(async () => {
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ userId: fieldId } = await signInAs("field@test.local"));
  fieldEmail = (await service.from("profiles").select("email").eq("id", fieldId).single()).data!.email;
  await service.from("sync_outbox").delete().eq("provider", "google_calendar");
});

beforeEach(async () => {
  calls = [];
  await connect();
  // Start each test with nothing queued from the previous one.
  await service.from("sync_outbox").update({ status: "done" }).in("status", ["pending", "processing"]);
});

afterAll(async () => {
  await service.from("integration_connections").delete().eq("provider", "google_calendar");
  await service.from("sync_outbox").delete().eq("provider", "google_calendar");
  for (const id of customers) {
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
});

describe("syncing an appointment", () => {
  it("insert → 200 stores the event id; the event has the address, the CRM link, and the assignee as attendee", async () => {
    const a = await appointment();
    expect(await outbox(a.id)).toMatchObject([{ status: "pending" }]);
    expect((await row(a.id)).google_sync_status).toBe("pending");

    expect(await processOutbox(ok)).toMatchObject({ claimed: 1, done: 1 });
    expect(await row(a.id)).toEqual({ google_event_id: eventIdFor(a.id), google_sync_status: "synced", google_sync_error: null });
    expect(await outbox(a.id)).toMatchObject([{ status: "done" }]);

    expect(calls).toHaveLength(1);
    const [insert] = calls;
    expect(insert!.method).toBe("POST");
    expect(insert!.url).toBe("https://www.googleapis.com/calendar/v3/calendars/cal_test/events?sendUpdates=none");
    expect(insert!.body).toMatchObject({
      id: a.id.replaceAll("-", ""),
      summary: `Inspection: ${a.name} — Roof Repair`,
      location: `${seq} Event Blvd, Springfield, 62701`,
      attendees: [{ email: fieldEmail }],
      extendedProperties: { private: { crm_appointment_id: a.id } },
    });
    const description = String(insert!.body!.description);
    expect(description).toContain("Bring the tall ladder");
    expect(description).toContain(`/opportunities/${a.dealId}`);
    expect(description).toContain("Managed by the CRM. Changes made in Google Calendar will be overwritten.");
    expect(JSON.stringify(insert!.body)).not.toMatch(/\$\s?\d/); // never a price
  });

  it("insert → 409 falls back to patch, so a retry cannot create a second event", async () => {
    const a = await appointment();
    const google = fakeGoogle((call) => (call.method === "POST" ? { status: 409, body: { error: { message: "The requested identifier already exists." } } } : { status: 200, body: {} }));
    expect(await processOutbox(google)).toMatchObject({ done: 1 });
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH"]);
    expect(calls[1]!.url).toBe(`https://www.googleapis.com/calendar/v3/calendars/cal_test/events/${eventIdFor(a.id)}?sendUpdates=none`);
    expect(calls[1]!.body).toMatchObject({ status: "confirmed" }); // revives an event deleted in Google
    expect(calls[1]!.body).not.toHaveProperty("id");
    expect((await row(a.id)).google_sync_status).toBe("synced");
  });

  it("rescheduling updates the event, cancelling deletes it, and delete → 404 counts as success", async () => {
    const a = await appointment();
    await processOutbox(ok);
    calls = [];

    await sales.rpc("reschedule_appointment", { p_appointment_id: a.id, p_starts_at: "2031-05-07T18:00:00Z", p_ends_at: "2031-05-07T19:00:00Z" });
    await processOutbox(fakeGoogle((call) => (call.method === "POST" ? { status: 409 } : { status: 200 })));
    expect(calls.at(-1)!.method).toBe("PATCH");
    expect(calls.at(-1)!.body).toMatchObject({ start: { dateTime: "2031-05-07T18:00:00.000Z" } });

    calls = [];
    await sales.rpc("cancel_appointment", { p_appointment_id: a.id });
    expect(await processOutbox(fakeGoogle(() => ({ status: 404, body: { error: { message: "Not Found" } } })))).toMatchObject({ done: 1 });
    expect(calls.map((c) => c.method)).toEqual(["DELETE"]);
    expect(await row(a.id)).toMatchObject({ google_event_id: null, google_sync_status: "synced" });
  });

  it("ten rapid edits leave one pending outbox row", async () => {
    const a = await appointment();
    for (let i = 0; i < 10; i++) {
      const { error } = await sales.from("appointments").update({ title: `Inspection, edit ${i}` }).eq("id", a.id);
      expect(error).toBeNull();
    }
    expect((await outbox(a.id)).filter((r) => r.status === "pending")).toHaveLength(1);
    expect(await processOutbox(ok)).toMatchObject({ claimed: 1, done: 1 });
    expect(calls).toHaveLength(1);
  });
});

describe("failures", () => {
  it("500 schedules a retry with backoff; eight failures mark the row failed and put the error on the appointment", async () => {
    const a = await appointment();
    const down = fakeGoogle(() => ({ status: 500, body: {} }));

    expect(await processOutbox(down)).toMatchObject({ claimed: 1, retried: 1 });
    const [first] = await outbox(a.id);
    expect(first).toMatchObject({ status: "pending", attempts: 1, last_error: "Google Calendar returned 500" });
    const wait = new Date(first!.next_attempt_at).getTime() - Date.now();
    expect(wait).toBeGreaterThan(60_000); // 2^1 minutes
    expect(wait).toBeLessThan(3 * 60_000);
    expect(await processOutbox(down)).toMatchObject({ claimed: 0 }); // not due yet

    for (let attempt = 2; attempt <= 7; attempt++) {
      await makeDue(a.id);
      expect(await processOutbox(down)).toMatchObject({ retried: 1 });
    }
    await makeDue(a.id);
    expect(await processOutbox(down)).toMatchObject({ failed: 1 });
    expect(await outbox(a.id)).toMatchObject([{ status: "failed", attempts: 8 }]);
    expect(await row(a.id)).toMatchObject({ google_sync_status: "error", google_sync_error: "Google Calendar returned 500" });

    // The appointment itself is untouched and can still be changed
    expect((await sales.from("appointments").update({ notes: "Still editable" }).eq("id", a.id)).error).toBeNull();
  });

  it("a revoked connection holds the queue without using up attempts; reconnecting drains it", async () => {
    const a = await appointment();
    const b = await appointment();
    expect(await processOutbox(fakeGoogle(() => ({ status: 401, body: {} })))).toMatchObject({ claimed: 2, held: 2 });
    expect(calls).toHaveLength(1); // the rest of the batch is not sent once the connection is known to be down
    const { data: connection } = await service.from("integration_connections").select("status, last_error").eq("provider", "google_calendar").single();
    expect(connection).toMatchObject({ status: "error" });
    expect(connection!.last_error).toContain("Reconnect");
    expect(await outbox(a.id)).toMatchObject([{ status: "pending", attempts: 0 }]);

    // Appointments still save while Google is disconnected
    const c = await appointment();
    expect(c.id).toBeTruthy();

    await connect();
    await enqueueAppointments(null, [a.id, b.id, c.id]); // what Reconnect and Retry do
    for (const id of [a.id, b.id, c.id]) await makeDue(id);
    calls = [];
    expect(await processOutbox(ok)).toMatchObject({ claimed: 3, done: 3 });
    expect((await row(c.id)).google_sync_status).toBe("synced");
  });
});

describe("tokens", () => {
  it("refreshes an expiring token, stores it encrypted, and keeps a newly issued refresh token", async () => {
    await connect({ expires_at: new Date(Date.now() + 60_000).toISOString() });
    const a = await appointment();
    const google = fakeGoogle((call) =>
      call.url.includes("oauth2.googleapis.com/token") ? { status: 200, body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 } } : { status: 200, body: {} },
    );
    expect(await processOutbox(google)).toMatchObject({ done: 1 });
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });

    const { data: connection } = await service.from("integration_connections").select("access_token_enc, refresh_token_enc, expires_at, config").eq("provider", "google_calendar").single();
    expect(connection!.access_token_enc).not.toContain("access-2");
    expect(decrypt(connection!.access_token_enc!)).toBe("access-2");
    expect(decrypt(connection!.refresh_token_enc!)).toBe("refresh-2");
    expect(new Date(connection!.expires_at!).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(connection!.config).not.toHaveProperty("refresh_lease_until"); // the lease was released
    expect((await row(a.id)).google_sync_status).toBe("synced");
  });

  it("a revoked refresh token marks the connection as needing a reconnect", async () => {
    await connect({ expires_at: new Date(Date.now() - 1000).toISOString() });
    await appointment();
    expect(await processOutbox(fakeGoogle(() => ({ status: 400, body: { error: "invalid_grant" } })))).toMatchObject({ held: 1 });
    expect((await service.from("integration_connections").select("status").eq("provider", "google_calendar").single()).data!.status).toBe("error");
  });
});

describe("queueing and access", () => {
  it("nothing is queued while Google is not connected; Backfill queues future scheduled appointments once", async () => {
    await service.from("integration_connections").update({ status: "disconnected" }).eq("provider", "google_calendar");
    const a = await appointment();
    expect(await outbox(a.id)).toEqual([]);
    expect((await row(a.id)).google_sync_status).toBe("not_synced");

    await connect();
    expect(await enqueueAppointments(null)).toBeGreaterThanOrEqual(1);
    expect(await enqueueAppointments(null)).toBe(0); // already queued: nothing added
    expect((await outbox(a.id)).filter((r) => r.status === "pending")).toHaveLength(1);
    // The nightly window: this appointment is years away, so a 60-day re-assert does not include it
    await service.from("sync_outbox").update({ status: "done" }).eq("entity_id", a.id);
    await enqueueAppointments(60);
    expect((await outbox(a.id)).filter((r) => r.status === "pending")).toHaveLength(0);
  });

  it("signed-in users cannot run the worker's functions or read connections and the outbox", async () => {
    expect((await sales.rpc("claim_outbox_batch", { p_limit: 5 })).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.rpc("complete_outbox", { p_id: "00000000-0000-4000-8000-000000000000" })).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.rpc("fail_outbox", { p_id: "00000000-0000-4000-8000-000000000000", p_error: "x" })).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.rpc("lock_integration", { p_provider: "google_calendar" })).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.rpc("unlock_integration", { p_provider: "google_calendar" })).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.rpc("enqueue_appointment_syncs", {})).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.from("integration_connections").select("provider")).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.from("sync_outbox").select("id")).error?.code).toBe(PERMISSION_DENIED);
  });
});
