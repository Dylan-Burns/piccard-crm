import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUCKET } from "@/features/files/categories";
import type { Json } from "@/types/database";
import { PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";

// Invoice lifecycle functions (spec §4.6, §7.5): amounts come from the accepted estimate and are
// never edited by hand; admins regenerate, void, mark sent, and record payments.
const service = serviceClient();
let admin: Client, sales: Client, field: Client;
let salesId: string;
const customers: string[] = [];
let seq = 0;

/** A won deal whose $10,000 estimate (30% deposit) produced a deposit and a final draft invoice. */
async function jobWithInvoices() {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const email = `bill${n}@example.com`;
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Bill", last_name: `Payer${n}`, phone: `567${n}`, phone_e164: `+1224${n}`, email, address_line1: `${seq} Ledger Ln`, postal_code: "62701", work_type: "roof_replacement", owner_id: salesId } as Json,
  });
  const lead = data as { opportunity_id: string; customer_id: string };
  customers.push(lead.customer_id);
  const estimateId = ((await sales.rpc("create_estimate", { p_opportunity_id: lead.opportunity_id })).data as { estimate_id: string }).estimate_id;
  await sales.rpc("save_estimate_lines", { p_estimate_id: estimateId, p_lines: [{ name: "Roof", quantity: "1", unit_price_cents: 1_000_000 }] as Json });
  const path = `${lead.customer_id}/${lead.opportunity_id}/${randomUUID()}.pdf`;
  await service.storage.from(BUCKET).upload(path, Buffer.from("%PDF-1.4\n%%EOF\n"), { contentType: "application/pdf" });
  await sales.rpc("mark_estimate_sent", { p_estimate_id: estimateId, p_email: email, p_pdf_path: path });
  const won = (await sales.rpc("mark_opportunity_won", { p_opportunity_id: lead.opportunity_id, p_estimate_id: estimateId })).data as { job_id: string };
  const invoices = await list(won.job_id);
  return { jobId: won.job_id, dealId: lead.opportunity_id, customerId: lead.customer_id, deposit: invoices.find((i) => i.kind === "deposit")!, final: invoices.find((i) => i.kind === "final")! };
}
const list = async (jobId: string) => (await service.from("invoices").select("*").eq("job_id", jobId).neq("status", "void").order("kind")).data!;
const invoice = async (id: string) => (await service.from("invoices").select("*").eq("id", id).single()).data!;
const manual = (client: Client, id: string, args: { p_status?: "sent"; p_amount_paid_cents?: number }) => client.rpc("record_invoice_manually", { p_invoice_id: id, ...args });
const payments = async (dealId: string) => (await service.from("activities").select("summary, metadata").eq("opportunity_id", dealId).eq("type", "payment_received").order("created_at")).data!;

beforeAll(async () => {
  ({ client: admin } = await signInAs("admin@test.local"));
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field } = await signInAs("field@test.local"));
  await service.from("integration_connections").delete().eq("provider", "quickbooks");
});

afterAll(async () => {
  await service.from("integration_connections").delete().eq("provider", "quickbooks");
  await service.from("sync_outbox").delete().eq("provider", "quickbooks");
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

describe("who can do what", () => {
  it("sales read invoices but cannot change them; field users see none; amounts cannot be edited by anyone", async () => {
    const { jobId, deposit, final } = await jobWithInvoices();
    expect([deposit.total_cents, final.total_cents]).toEqual([300_000, 700_000]);

    expect((await sales.from("invoices").select("id").eq("job_id", jobId)).data).toHaveLength(2);
    expect((await field.from("invoices").select("id").eq("job_id", jobId)).error?.code ?? "empty").toMatch(/42501|empty/);
    expect((await field.from("invoices").select("id").eq("job_id", jobId)).data ?? []).toEqual([]);

    for (const client of [sales, field]) {
      expect((await client.rpc("void_invoice", { p_invoice_id: deposit.id })).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.rpc("regenerate_job_invoices", { p_job_id: jobId })).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.rpc("queue_invoice_sync", { p_invoice_id: deposit.id })).error?.code).toBe(PERMISSION_DENIED);
      expect((await manual(client, deposit.id, { p_status: "sent" })).error?.code).toBe(PERMISSION_DENIED);
    }
    for (const client of [admin, sales]) {
      expect((await client.rpc("complete_invoice_sync", { p_invoice_id: deposit.id, p_qbo_invoice_id: "1", p_doc_number: "1" })).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.rpc("apply_invoice_payment", { p_invoice_id: deposit.id, p_amount_paid_cents: 1 })).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.from("invoices").update({ total_cents: 1 }).eq("id", deposit.id)).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.from("invoices").update({ status: "paid" }).eq("id", deposit.id)).error?.code).toBe(PERMISSION_DENIED);
      expect((await client.from("invoice_line_items").update({ amount_cents: 1 }).eq("invoice_id", deposit.id)).error?.code).toBe(PERMISSION_DENIED);
    }
    // The due date is the one thing an admin edits directly; sales cannot
    expect((await admin.from("invoices").update({ due_on: "2031-01-15" }).eq("id", deposit.id).select("id")).data).toHaveLength(1);
    expect((await sales.from("invoices").update({ due_on: "2031-02-01" }).eq("id", deposit.id).select("id")).data ?? []).toEqual([]);
    expect((await invoice(deposit.id)).due_on).toBe("2031-01-15");
  });
});

describe("void and regenerate", () => {
  it("regenerating voids the drafts and recreates them from the accepted estimate; it is refused once one is sent", async () => {
    const { jobId, deposit, final } = await jobWithInvoices();
    expect((await admin.rpc("void_invoice", { p_invoice_id: deposit.id })).data).toEqual({ ok: true });
    expect((await admin.rpc("void_invoice", { p_invoice_id: deposit.id })).data).toEqual({ ok: true, already: true });
    expect(await list(jobId)).toHaveLength(1);

    expect((await admin.rpc("regenerate_job_invoices", { p_job_id: jobId })).data).toEqual({ ok: true });
    const fresh = await list(jobId);
    expect(fresh.map((i) => [i.kind, i.status, i.total_cents])).toEqual([["deposit", "draft", 300_000], ["final", "draft", 700_000]]);
    expect(fresh.map((i) => i.id)).not.toContain(final.id); // new rows; the old ones are void
    expect((await invoice(final.id)).status).toBe("void");
    const { data: lines } = await service.from("invoice_line_items").select("amount_cents").in("invoice_id", fresh.map((i) => i.id));
    expect(lines!.reduce((sum, l) => sum + l.amount_cents, 0)).toBe(1_000_000);

    await manual(admin, fresh[0]!.id, { p_status: "sent" });
    expect((await admin.rpc("regenerate_job_invoices", { p_job_id: jobId })).data).toMatchObject({ ok: false, code: "already_sent" });
    expect((await admin.rpc("void_invoice", { p_invoice_id: fresh[0]!.id })).data).toMatchObject({ ok: false, code: "not_draft" });
    expect(await list(jobId)).toHaveLength(2);
  });

  it("a job won without an estimate has no invoices to regenerate", async () => {
    const { data } = await service.rpc("create_lead", { p: { channel: "manual", first_name: "No", last_name: `Estimate${Date.now()}`, phone: `568${String(Date.now()).slice(-7)}`, phone_e164: `+1331${String(Date.now()).slice(-7)}`, address_line1: "9 Cash St", postal_code: "62701", work_type: "gutters", owner_id: salesId } as Json });
    const lead = data as { opportunity_id: string; customer_id: string };
    customers.push(lead.customer_id);
    const won = (await sales.rpc("mark_opportunity_won", { p_opportunity_id: lead.opportunity_id, p_amount_cents: 90_000 })).data as { job_id: string };
    expect((await admin.rpc("regenerate_job_invoices", { p_job_id: won.job_id })).data).toMatchObject({ ok: false, code: "no_estimate" });
  });
});

describe("manual sent and paid", () => {
  it("mark sent, then payments: sent → partially paid → paid, one timeline entry per increase and no amounts in the text", async () => {
    const { dealId, deposit } = await jobWithInvoices();
    expect((await manual(admin, deposit.id, {})).data).toMatchObject({ ok: false, code: "invalid" });
    expect((await manual(admin, deposit.id, { p_status: "sent" })).data).toEqual({ ok: true, status: "sent" });
    let row = await invoice(deposit.id);
    expect(row).toMatchObject({ status: "sent", amount_paid_cents: 0 });
    expect(row.issued_on).toBeTruthy();
    expect((await manual(admin, deposit.id, { p_status: "sent" })).data).toEqual({ ok: true, already: true });

    expect((await manual(admin, deposit.id, { p_amount_paid_cents: 100_000 })).data).toEqual({ ok: true, status: "partially_paid" });
    expect((await manual(admin, deposit.id, { p_amount_paid_cents: 100_000 })).data).toEqual({ ok: true, status: "partially_paid" }); // same amount again
    expect((await manual(admin, deposit.id, { p_amount_paid_cents: 300_001 })).data).toMatchObject({ ok: false, code: "invalid" });
    expect((await manual(admin, deposit.id, { p_amount_paid_cents: -1 })).data).toMatchObject({ ok: false, code: "invalid" });
    expect((await manual(admin, deposit.id, { p_amount_paid_cents: 300_000 })).data).toEqual({ ok: true, status: "paid" });
    row = await invoice(deposit.id);
    expect(row).toMatchObject({ status: "paid", amount_paid_cents: 300_000 });
    expect(row.paid_at).toBeTruthy();

    const entries = await payments(dealId);
    expect(entries).toHaveLength(2); // two increases
    expect(entries.map((e) => (e.metadata as { amount_cents: number }).amount_cents)).toEqual([100_000, 200_000]);
    expect(entries.every((e) => !/\$|\d{3,}/.test(e.summary.replace(/INV-\d+/, "")))).toBe(true);

    // A correction downwards is allowed and adds no payment entry
    expect((await manual(admin, deposit.id, { p_amount_paid_cents: 0 })).data).toEqual({ ok: true, status: "sent" });
    expect((await invoice(deposit.id)).paid_at).toBeNull();
    expect(await payments(dealId)).toHaveLength(2);
  });

  it("a draft can be paid directly, and a void invoice cannot be changed", async () => {
    const { deposit, final } = await jobWithInvoices();
    expect((await manual(admin, final.id, { p_amount_paid_cents: 700_000 })).data).toEqual({ ok: true, status: "paid" });
    expect((await invoice(final.id)).issued_on).toBeTruthy();
    await admin.rpc("void_invoice", { p_invoice_id: deposit.id });
    expect((await manual(admin, deposit.id, { p_status: "sent" })).data).toMatchObject({ ok: false, code: "void" });
  });
});

describe("QuickBooks hand-off", () => {
  it("Send to QuickBooks needs a connected, configured QuickBooks; then queues once", async () => {
    const { deposit } = await jobWithInvoices();
    expect((await admin.rpc("queue_invoice_sync", { p_invoice_id: deposit.id })).data).toMatchObject({ ok: false, code: "not_connected" });
    await service.from("integration_connections").upsert({ provider: "quickbooks", status: "connected", external_account_id: "realm-1", config: { environment: "sandbox" } });
    expect((await admin.rpc("queue_invoice_sync", { p_invoice_id: deposit.id })).data).toMatchObject({ ok: false, code: "not_configured" });
    await service.from("integration_connections").update({ config: { environment: "sandbox", item_id: "7" } }).eq("provider", "quickbooks");

    expect((await admin.rpc("queue_invoice_sync", { p_invoice_id: deposit.id })).data).toEqual({ ok: true });
    expect((await admin.rpc("queue_invoice_sync", { p_invoice_id: deposit.id })).data).toEqual({ ok: true, already: true }); // a second click
    expect((await invoice(deposit.id)).qbo_sync_status).toBe("pending");
    expect((await service.from("sync_outbox").select("id").eq("entity_id", deposit.id).eq("status", "pending")).data).toHaveLength(1);
    // While it is on its way it cannot be voided or handled manually
    expect((await admin.rpc("void_invoice", { p_invoice_id: deposit.id })).data).toMatchObject({ ok: false, code: "not_draft" });
    expect((await manual(admin, deposit.id, { p_status: "sent" })).data).toMatchObject({ ok: false, code: "managed_by_quickbooks" });
  });

  it("the worker's functions: accepted by QuickBooks → sent and synced; payments found there → partially paid, paid, or void", async () => {
    const { dealId, customerId, deposit, final } = await jobWithInvoices();
    await service.rpc("complete_invoice_sync", { p_invoice_id: deposit.id, p_qbo_invoice_id: "145", p_doc_number: "1038", p_qbo_customer_id: "58" });
    expect(await invoice(deposit.id)).toMatchObject({ status: "sent", qbo_invoice_id: "145", qbo_doc_number: "1038", qbo_sync_status: "synced", qbo_sync_error: null });
    expect((await service.from("customers").select("qbo_customer_id").eq("id", customerId).single()).data!.qbo_customer_id).toBe("58");
    expect((await service.from("activities").select("id").eq("opportunity_id", dealId).eq("type", "invoice_synced")).data).toHaveLength(1);
    expect((await manual(admin, deposit.id, { p_amount_paid_cents: 1 })).data).toMatchObject({ ok: false, code: "managed_by_quickbooks" });

    expect((await service.rpc("apply_invoice_payment", { p_invoice_id: deposit.id, p_amount_paid_cents: 0 })).data).toBe("unchanged");
    expect((await service.rpc("apply_invoice_payment", { p_invoice_id: deposit.id, p_amount_paid_cents: 120_000 })).data).toBe("partially_paid");
    expect((await service.rpc("apply_invoice_payment", { p_invoice_id: deposit.id, p_amount_paid_cents: 120_000 })).data).toBe("unchanged");
    expect((await service.rpc("apply_invoice_payment", { p_invoice_id: deposit.id, p_amount_paid_cents: 300_000 })).data).toBe("paid");
    expect(await invoice(deposit.id)).toMatchObject({ status: "paid", amount_paid_cents: 300_000 });
    expect(await payments(dealId)).toHaveLength(2);
    expect((await service.rpc("apply_invoice_payment", { p_invoice_id: deposit.id, p_amount_paid_cents: 0 })).data).toBe("ignored"); // paid is final here

    // A total mismatch is recorded as a warning, and an invoice deleted in QuickBooks becomes void
    await service.rpc("complete_invoice_sync", { p_invoice_id: final.id, p_qbo_invoice_id: "146", p_doc_number: "1039", p_warning: "Total differs in QuickBooks: 7,100.00" });
    expect(await invoice(final.id)).toMatchObject({ status: "sent", qbo_sync_status: "synced", qbo_sync_error: "Total differs in QuickBooks: 7,100.00" });
    expect((await service.rpc("apply_invoice_payment", { p_invoice_id: final.id, p_amount_paid_cents: 0, p_missing: true })).data).toBe("void");
    expect((await invoice(final.id)).status).toBe("void");
  });
});
