import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUCKET } from "@/features/files/categories";
import type { Json } from "@/types/database";
import { PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";

type Result = { ok: boolean; code?: string; already?: boolean; changed?: boolean; estimate_id?: string; public_token?: string; job_id?: string; expired?: number; stale?: number };
let sales: Client, field: Client;
let salesId: string;
const service = serviceClient();
const customers: string[] = [];
const startedAt = new Date().toISOString();
let seq = 0;

async function newDeal() {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Life", last_name: `Cycle${n}`, phone: `560${n}`, phone_e164: `+1779${n}`, email: `life${n}@example.com`, address_line1: `${seq} Send St`, postal_code: "62701", work_type: "roof_replacement", owner_id: salesId } as Json,
  });
  const r = data as { opportunity_id: string; customer_id: string };
  customers.push(r.customer_id);
  return { dealId: r.opportunity_id, customerId: r.customer_id, email: `life${n}@example.com` };
}

/** A draft estimate with one $10,000 line (30% deposit by default), optionally expiring on a given day. */
async function draft(dealId: string, validUntil?: string) {
  const { data } = await sales.rpc("create_estimate", { p_opportunity_id: dealId });
  const id = (data as Result).estimate_id!;
  await sales.rpc("save_estimate_lines", { p_estimate_id: id, p_lines: [{ name: "Roof", quantity: "1", unit: "ea", unit_price_cents: 1_000_000 }] as Json });
  if (validUntil) await sales.from("estimates").update({ valid_until: validUntil }).eq("id", id);
  return id;
}

/** Stores a PDF where the send action would, and returns its path. */
async function storePdf(customerId: string, dealId: string) {
  const path = `${customerId}/${dealId}/${randomUUID()}.pdf`;
  const { error } = await service.storage.from(BUCKET).upload(path, Buffer.from("%PDF-1.4\n%%EOF\n"), { contentType: "application/pdf" });
  if (error) throw new Error(error.message);
  return path;
}

async function send(deal: { dealId: string; customerId: string; email: string }, estimateId: string) {
  const path = await storePdf(deal.customerId, deal.dealId);
  const { data, error } = await sales.rpc("mark_estimate_sent", { p_estimate_id: estimateId, p_email: deal.email, p_pdf_path: path });
  if (error) throw new Error(error.message);
  return { result: data as Result, path };
}

const estimate = async (id: string) => (await service.from("estimates").select("*").eq("id", id).single()).data!;
const deal = async (id: string) => (await service.from("opportunities").select("stage, estimated_value_cents, amount_cents").eq("id", id).single()).data!;
const openKeys = async (id: string) => (await service.from("tasks").select("auto_key").eq("opportunity_id", id).eq("status", "open")).data!.map((t) => t.auto_key).sort();

beforeAll(async () => {
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field } = await signInAs("field@test.local"));
});

afterAll(async () => {
  // run_nightly_maintenance touches every open deal: remove the tasks it gave other tests' data.
  await service.from("tasks").delete().eq("auto_key", "stale_deal").gte("created_at", startedAt);
  for (const id of customers) {
    const { data: rows } = await service.from("files").select("storage_path").eq("customer_id", id);
    if (rows?.length) await service.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
    const { data: jobs } = await service.from("jobs").select("id").eq("customer_id", id);
    for (const j of jobs ?? []) {
      await service.from("invoices").delete().eq("job_id", j.id);
      await service.from("jobs").delete().eq("id", j.id);
    }
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
});

describe("mark_estimate_sent", () => {
  it("sends: status, PDF file row, deal value and stage, follow-up task, one activity", async () => {
    const d = await newDeal();
    const id = await draft(d.dealId);
    const { result, path } = await send(d, id);
    expect(result.ok).toBe(true);

    const e = await estimate(id);
    expect(e).toMatchObject({ status: "sent", sent_to_email: d.email, pdf_path: path, total_cents: 1_000_000 });
    expect(e.sent_at).toBeTruthy();
    expect(result.public_token).toBe(e.public_token);
    expect(await deal(d.dealId)).toMatchObject({ stage: "estimate_sent", estimated_value_cents: 1_000_000 });
    const { data: file } = await service.from("files").select("category, mime_type, storage_path, uploaded_by, file_name").eq("opportunity_id", d.dealId).single();
    expect(file).toMatchObject({ category: "estimate", mime_type: "application/pdf", storage_path: path, uploaded_by: salesId });
    expect(file!.file_name).toMatch(/^Estimate E-\d+\.pdf$/);
    expect(await openKeys(d.dealId)).toContain("estimate_followup");
    const { data: acts } = await service.from("activities").select("summary").eq("opportunity_id", d.dealId).eq("type", "estimate_sent");
    expect(acts).toHaveLength(1);
    expect(acts![0]!.summary).not.toContain("$");

    // Sending again changes nothing
    const again = await sales.rpc("mark_estimate_sent", { p_estimate_id: id, p_email: d.email, p_pdf_path: path });
    expect(again.data).toMatchObject({ ok: true, already: true });
    // A field user can see neither the estimate nor its PDF
    expect((await field.from("files").select("id").eq("opportunity_id", d.dealId)).data ?? []).toEqual([]);
  });

  it("refuses an empty estimate, a missing email, a path outside the deal, and field users", async () => {
    const d = await newDeal();
    const other = await newDeal();
    const { data } = await sales.rpc("create_estimate", { p_opportunity_id: d.dealId });
    const empty = (data as Result).estimate_id!;
    const path = await storePdf(d.customerId, d.dealId);
    expect((await sales.rpc("mark_estimate_sent", { p_estimate_id: empty, p_email: d.email, p_pdf_path: path })).data).toMatchObject({ ok: false, code: "empty" });

    const id = await draft(d.dealId);
    expect((await sales.rpc("mark_estimate_sent", { p_estimate_id: id, p_email: " ", p_pdf_path: path })).data).toMatchObject({ ok: false, code: "no_email" });
    const foreign = await storePdf(other.customerId, other.dealId);
    expect((await sales.rpc("mark_estimate_sent", { p_estimate_id: id, p_email: d.email, p_pdf_path: foreign })).data).toMatchObject({ ok: false, code: "invalid" });
    expect((await sales.rpc("mark_estimate_sent", { p_estimate_id: id, p_email: d.email, p_pdf_path: `${d.customerId}/${d.dealId}/${randomUUID()}.pdf` })).data).toMatchObject({ ok: false, code: "invalid" });
    expect((await field.rpc("mark_estimate_sent", { p_estimate_id: id, p_email: d.email, p_pdf_path: path })).error?.code).toBe(PERMISSION_DENIED);

    expect((await estimate(id)).status).toBe("draft");
    expect((await deal(d.dealId)).stage).toBe("new");
    await service.storage.from(BUCKET).remove([path, foreign]);
  });
});

describe("revise_estimate", () => {
  it("clones into a draft with the next version; sending it voids the previous one and moves the deal to Negotiation", async () => {
    const d = await newDeal();
    const v1 = await draft(d.dealId);
    expect((await sales.rpc("revise_estimate", { p_estimate_id: v1 })).data).toMatchObject({ ok: false, code: "invalid_status" }); // still a draft
    await send(d, v1);

    const revised = (await sales.rpc("revise_estimate", { p_estimate_id: v1 })).data as Result;
    expect(revised.ok).toBe(true);
    const first = await estimate(v1);
    const second = await estimate(revised.estimate_id!);
    expect(second).toMatchObject({ status: "draft", version: 2, estimate_number: first.estimate_number, total_cents: first.total_cents, title: first.title });
    expect(second.public_token).not.toBe(first.public_token);
    expect((await service.from("estimate_line_items").select("name").eq("estimate_id", second.id)).data).toEqual([{ name: "Roof" }]);
    expect(first.status).toBe("sent"); // unchanged until the revision is sent
    expect((await sales.rpc("revise_estimate", { p_estimate_id: v1 })).data).toMatchObject({ ok: true, already: true, estimate_id: second.id });
    expect((await field.rpc("revise_estimate", { p_estimate_id: v1 })).error?.code).toBe(PERMISSION_DENIED);

    await send(d, second.id);
    expect((await estimate(v1)).status).toBe("void");
    expect((await estimate(second.id)).status).toBe("sent");
    expect((await deal(d.dealId)).stage).toBe("negotiation");
  });
});

describe("public page actions (service role only)", () => {
  it("a view is recorded once; signed-in users cannot call these", async () => {
    const d = await newDeal();
    const id = await draft(d.dealId);
    await send(d, id);
    const token = (await estimate(id)).public_token;

    for (const client of [sales, field]) {
      expect((await client.rpc("record_estimate_view", { p_token: token })).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.rpc("accept_estimate", { p_token: token, p_name: "Mallory" })).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.rpc("decline_estimate", { p_token: token })).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.rpc("run_nightly_maintenance")).error?.code).toBe(PERMISSION_DENIED);
    }
    expect((await estimate(id)).status).toBe("sent");

    expect((await service.rpc("record_estimate_view", { p_token: token })).data).toEqual({ ok: true, changed: true });
    expect(await estimate(id)).toMatchObject({ status: "viewed" });
    expect((await service.rpc("record_estimate_view", { p_token: token })).data).toEqual({ ok: true, changed: false });
    expect((await service.rpc("record_estimate_view", { p_token: randomUUID() })).data).toEqual({ ok: true, changed: false });
    expect((await service.from("activities").select("id").eq("opportunity_id", d.dealId).eq("type", "estimate_viewed")).data).toHaveLength(1);
  });

  it("approving by token records name and IP, wins the deal, creates the job and invoices, and voids other estimates", async () => {
    const d = await newDeal();
    const id = await draft(d.dealId);
    const otherDraft = await draft(d.dealId);
    await send(d, id);
    const token = (await estimate(id)).public_token;

    expect((await service.rpc("accept_estimate", { p_token: token, p_name: " " })).data).toMatchObject({ ok: false, code: "name_required" });
    expect((await estimate(id)).status).toBe("sent");

    const accepted = (await service.rpc("accept_estimate", { p_token: token, p_name: "  Life Cycle  ", p_ip: "203.0.113.9" })).data as Result;
    expect(accepted.ok).toBe(true);
    const e = await estimate(id);
    expect(e).toMatchObject({ status: "accepted", accepted_name: "Life Cycle", accepted_ip: "203.0.113.9" });
    expect(e.accepted_at).toBeTruthy();
    expect(await deal(d.dealId)).toMatchObject({ stage: "won", amount_cents: 1_000_000 });
    expect((await estimate(otherDraft)).status).toBe("void");

    const { data: jobs } = await service.from("jobs").select("id, accepted_estimate_id").eq("opportunity_id", d.dealId);
    expect(jobs).toEqual([{ id: accepted.job_id, accepted_estimate_id: id }]);
    const { data: invoices } = await service.from("invoices").select("kind, status, total_cents").eq("job_id", accepted.job_id!).order("kind");
    expect(invoices).toEqual([
      { kind: "deposit", status: "draft", total_cents: 300_000 },
      { kind: "final", status: "draft", total_cents: 700_000 },
    ]);
    const { data: won } = await service.from("opportunities").select("closed_by").eq("id", d.dealId).single();
    expect(won!.closed_by).toBeNull(); // closed by the customer, not a user

    // Twice is a no-op
    expect((await service.rpc("accept_estimate", { p_token: token, p_name: "Someone Else", p_ip: "198.51.100.1" })).data).toMatchObject({ ok: true, already: true });
    expect((await estimate(id)).accepted_name).toBe("Life Cycle");
    expect((await service.from("jobs").select("id").eq("opportunity_id", d.dealId)).data).toHaveLength(1);
    expect((await service.from("activities").select("id").eq("opportunity_id", d.dealId).eq("type", "estimate_accepted")).data).toHaveLength(1);
  });

  it("a void, expired, or unknown token cannot be approved; a bad IP is ignored", async () => {
    const d = await newDeal();
    const id = await draft(d.dealId);
    await send(d, id);
    const token = (await estimate(id)).public_token;
    await sales.rpc("void_estimate", { p_estimate_id: id });
    expect((await service.rpc("accept_estimate", { p_token: token, p_name: "Life Cycle" })).data).toMatchObject({ ok: false, code: "not_available" });
    expect((await service.rpc("decline_estimate", { p_token: token })).data).toMatchObject({ ok: false, code: "not_available" });
    expect((await service.rpc("accept_estimate", { p_token: randomUUID(), p_name: "Life Cycle" })).data).toMatchObject({ ok: false, code: "not_found" });
    expect((await deal(d.dealId)).stage).not.toBe("won");

    const late = await newDeal();
    const past = await draft(late.dealId, "2020-01-01");
    await send(late, past);
    const lateToken = (await estimate(past)).public_token;
    expect((await service.rpc("accept_estimate", { p_token: lateToken, p_name: "Life Cycle" })).data).toMatchObject({ ok: false, code: "not_available" });

    const ok = await newDeal();
    const fine = await draft(ok.dealId);
    await send(ok, fine);
    expect((await service.rpc("accept_estimate", { p_token: (await estimate(fine)).public_token, p_name: "Life Cycle", p_ip: "not-an-ip" })).data).toMatchObject({ ok: true });
    expect((await estimate(fine)).accepted_ip).toBeNull();
  });

  it("declining records the reason and gives the owner a task; the deal is not lost", async () => {
    const d = await newDeal();
    const id = await draft(d.dealId);
    await send(d, id);
    const token = (await estimate(id)).public_token;
    expect((await service.rpc("decline_estimate", { p_token: token, p_reason: " Going with another roofer " })).data).toMatchObject({ ok: true });
    expect(await estimate(id)).toMatchObject({ status: "declined", decline_reason: "Going with another roofer" });
    expect((await deal(d.dealId)).stage).toBe("estimate_sent");
    const { data: task } = await service.from("tasks").select("assigned_to").eq("opportunity_id", d.dealId).eq("auto_key", "declined_followup").eq("status", "open").single();
    expect(task!.assigned_to).toBe(salesId);
    expect((await service.rpc("decline_estimate", { p_token: token })).data).toMatchObject({ ok: true, already: true });
    expect((await service.rpc("accept_estimate", { p_token: token, p_name: "Life Cycle" })).data).toMatchObject({ ok: false, code: "not_available" });
  });
});

describe("run_nightly_maintenance", () => {
  it("expires a past-due estimate and gives an open deal with no next step a task", async () => {
    const late = await newDeal();
    const past = await draft(late.dealId, "2020-01-01");
    await send(late, past);

    const stale = await newDeal();
    await service.from("tasks").update({ status: "cancelled" }).eq("opportunity_id", stale.dealId).eq("status", "open");
    expect(await openKeys(stale.dealId)).toEqual([]);

    const first = (await service.rpc("run_nightly_maintenance")).data as Result;
    expect(first.ok).toBe(true);
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(first.stale).toBeGreaterThanOrEqual(1);

    expect((await estimate(past)).status).toBe("expired");
    expect(await openKeys(late.dealId)).toContain("estimate_expired");
    expect((await service.from("activities").select("id").eq("opportunity_id", late.dealId).eq("type", "estimate_expired")).data).toHaveLength(1);
    expect(await openKeys(stale.dealId)).toEqual(["stale_deal"]);

    // Running it again the same night adds nothing
    const second = (await service.rpc("run_nightly_maintenance")).data as Result;
    expect(second).toMatchObject({ ok: true, expired: 0, stale: 0 });
    expect(await openKeys(stale.dealId)).toEqual(["stale_deal"]);
  });
});
