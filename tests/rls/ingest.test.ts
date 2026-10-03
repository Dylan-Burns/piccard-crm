import { afterAll, describe, expect, it } from "vitest";
import { processSubmission, receiveLead, retryLeadSubmissions, secretsMatch } from "@/features/leads/ingest";
import { retryEmails, sendEmail, type Sender } from "@/lib/integrations/resend";
import { PERMISSION_DENIED, serviceClient, signInAs } from "./helpers";

const service = serviceClient();
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const customers = new Set<string>();

async function cleanup() {
  for (const id of customers) {
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
  await service.from("lead_submissions").delete().like("external_id", "itest-%");
  await service.from("email_log").delete().like("dedupe_key", "itest:%");
}
afterAll(cleanup);

const website = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ submission_id: `itest-${id}`, name: `Web Lead${id}`, phone: `415555${id.slice(-4)}`, address: `${id.slice(-3)} Hook Rd`, zip: "62701", service: "Roof repair", ...extra });

async function track(submissionId: string) {
  const { data } = await service.from("lead_submissions").select("customer_id, status, opportunity_id, error").eq("id", submissionId).single();
  if (data?.customer_id) customers.add(data.customer_id);
  return data!;
}

describe("receiveLead (store first)", () => {
  it("stores the raw payload and answers 200 before any processing", async () => {
    const id = stamp();
    const result = await receiveLead("website", website(id), "203.0.113.7");
    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    const { data } = await service.from("lead_submissions").select("status, channel, payload, source_ip").eq("id", result.submissionId!).single();
    expect(data).toMatchObject({ status: "received", channel: "website", source_ip: "203.0.113.7" });
    expect((data!.payload as { name: string }).name).toBe(`Web Lead${id}`);
    await service.from("lead_submissions").delete().eq("id", result.submissionId!);
  });

  it("treats a repeated delivery as already received", async () => {
    const id = stamp();
    const first = await receiveLead("website", website(id), null);
    const second = await receiveLead("website", website(id), null);
    expect(second).toMatchObject({ status: 200, body: { ok: true, duplicate: true }, submissionId: null });
    expect(await processSubmission(first.submissionId!)).toBe("created");
    await track(first.submissionId!);
    const { count } = await service.from("lead_submissions").select("id", { count: "exact", head: true }).eq("external_id", `itest-${id}`);
    expect(count).toBe(1);
  });

  it("absorbs a double submit that has no submission id", async () => {
    const body = JSON.stringify({ name: `Double Click${stamp()}`, phone: "4155550177" });
    const first = await receiveLead("website", body, null);
    const second = await receiveLead("website", body, null);
    expect(second.body).toMatchObject({ duplicate: true });
    await service.from("lead_submissions").delete().eq("id", first.submissionId!);
  });

  it("rejects bodies that are not JSON objects", async () => {
    expect((await receiveLead("website", "not json", null)).status).toBe(400);
    expect((await receiveLead("website", "[1,2]", null)).status).toBe(400);
  });

  it("rate limits per IP: the 11th request in a minute gets 429", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await receiveLead("website", website(stamp()), ip);
      expect(r.status).toBe(200);
      ids.push(r.submissionId!);
    }
    expect((await receiveLead("website", website(stamp()), ip)).status).toBe(429);
    await service.from("lead_submissions").delete().in("id", ids);
  });

  it("answers 503 when the payload cannot be stored, so the sender retries", async () => {
    const broken = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "08006", message: "connection failure" } }) }) }),
      }),
    };
    const result = await receiveLead("website", website(stamp()), null, broken as never);
    expect(result).toMatchObject({ status: 503, submissionId: null });
  });
});

describe("processSubmission", () => {
  it("creates the lead once; processing again changes nothing", async () => {
    const id = stamp();
    const { submissionId } = await receiveLead("website", website(id, { message: "Shingles missing" }), null);
    expect(await processSubmission(submissionId!)).toBe("created");
    const row = await track(submissionId!);
    expect(row.status).toBe("created");
    expect(await processSubmission(submissionId!)).toBe("created");
    const { data: deals } = await service.from("opportunities").select("id, description").eq("customer_id", row.customer_id!);
    expect(deals).toHaveLength(1);
    expect(deals![0]!.description).toBe("Shingles missing");
    // The new-lead email was logged (it fails locally: no Resend key).
    const { data: emails } = await service.from("email_log").select("template, status").eq("opportunity_id", row.opportunity_id!);
    expect(emails).toHaveLength(1);
    expect(emails![0]!.template).toBe("new_lead");
    await service.from("email_log").delete().eq("opportunity_id", row.opportunity_id!);
  });

  it("merges a second inquiry for the same customer and address", async () => {
    const id = stamp();
    const first = await receiveLead("website", website(id), null);
    await processSubmission(first.submissionId!);
    const firstRow = await track(first.submissionId!);
    const second = await receiveLead("website", website(id, { submission_id: `itest-${id}-b`, message: "Still waiting" }), null);
    expect(await processSubmission(second.submissionId!)).toBe("merged_duplicate");
    const secondRow = await track(second.submissionId!);
    expect(secondRow).toMatchObject({ status: "merged_duplicate", opportunity_id: firstRow.opportunity_id });
    await service.from("email_log").delete().eq("opportunity_id", firstRow.opportunity_id!);
  });

  it("rejects honeypot and Google test leads without creating anything", async () => {
    const spam = await receiveLead("website", website(stamp(), { website: "http://spam.example" }), null);
    expect(await processSubmission(spam.submissionId!)).toBe("rejected");
    expect(await track(spam.submissionId!)).toMatchObject({ status: "rejected", error: "Honeypot filled", customer_id: null });

    const test = await receiveLead("google_ads", JSON.stringify({ lead_id: `itest-${stamp()}`, is_test: true, user_column_data: [] }), null);
    expect(await processSubmission(test.submissionId!)).toBe("rejected");
  });

  it("retries submissions that were stored but never processed", async () => {
    const id = stamp();
    const { submissionId } = await receiveLead("website", website(id), null);
    await service.from("lead_submissions").update({ received_at: new Date(Date.now() - 5 * 60_000).toISOString() }).eq("id", submissionId!);
    const { retried } = await retryLeadSubmissions();
    expect(retried).toBeGreaterThanOrEqual(1);
    const row = await track(submissionId!);
    expect(row.status).toBe("created");
    await service.from("email_log").delete().eq("opportunity_id", row.opportunity_id!);
  });

  it("process_lead_submission is service-role only", async () => {
    const { client } = await signInAs("admin@test.local");
    const { error } = await client.rpc("process_lead_submission" as never, { p_submission_id: "00000000-0000-0000-0000-000000000000", p_lead: {} } as never);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("email outbox", () => {
  it("a failed email is retried and delivered exactly once", async () => {
    const key = `itest:${stamp()}`;
    const delivered: string[] = [];
    const failing: Sender = async () => { throw new Error("provider down"); };
    const working: Sender = async ({ to, idempotencyKey }) => { delivered.push(`${to}|${idempotencyKey}`); return { id: "re_123" }; };
    const input = { dedupeKey: key, template: "new_lead" as const, to: "owner@test.local", subject: "New lead: X", props: { name: "X", phone: "", workType: "", address: "", source: "", message: "", url: "http://localhost:3000" } };

    expect(await sendEmail(input, failing)).toBe("failed");
    let { data: row } = await service.from("email_log").select("status, attempts, error").eq("dedupe_key", key).single();
    expect(row).toMatchObject({ status: "failed", attempts: 1, error: "provider down" });

    // The retry sweep picks it up; a failed row never blocks a later send.
    const sweep = await retryEmails(working);
    expect(sweep.sent).toBeGreaterThanOrEqual(1);
    ({ data: row } = await service.from("email_log").select("status, attempts, error").eq("dedupe_key", key).single());
    expect(row).toMatchObject({ status: "sent", attempts: 2, error: null });

    // Once sent, the same key is suppressed.
    expect(await sendEmail(input, working)).toBe("already_sent");
    expect(delivered.filter((d) => d.startsWith("owner@test.local"))).toHaveLength(1);
  });
});

describe("secretsMatch", () => {
  it("compares in constant time and rejects missing values", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abd", "abc")).toBe(false);
    expect(secretsMatch("abcd", "abc")).toBe(false);
    expect(secretsMatch(null, "abc")).toBe(false);
    expect(secretsMatch("abc", undefined)).toBe(false);
  });
});
