import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Integration settings for this file only, set before anything reads the environment.
process.env.INTEGRATION_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.QBO_CLIENT_ID ??= "test-qbo-client";
process.env.QBO_CLIENT_SECRET ??= "test-qbo-secret";

import { BUCKET } from "@/features/files/categories";
import { decrypt, encrypt } from "@/lib/integrations/crypto";
import { processOutbox } from "@/lib/integrations/outbox";
import { linkedToOtherCompany, pullPayments, type Fetch } from "@/lib/integrations/quickbooks";
import type { Json } from "@/types/database";
import { serviceClient, signInAs, type Client } from "./helpers";

// QuickBooks sync with Intuit's API replaced by a fake `fetch` (spec §9 Phase 13, step 8).
const service = serviceClient();
let admin: Client, sales: Client;
let salesId: string;
const customers: string[] = [];
let seq = 0;

type Call = { method: string; url: string; path: string; query: string | null; body: Record<string, unknown> | null };
let calls: Call[] = [];
type Reply = { status: number; body?: unknown };
/** A fake Intuit: `respond` answers each request; returning nothing means "an empty query result". */
function fakeIntuit(respond: (call: Call) => Reply | undefined): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const raw = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null;
    const call: Call = { method: init?.method ?? "GET", url: String(input), path: url.pathname.replace(/^\/v3\/company\/[^/]+/, ""), query: url.searchParams.get("query"), body: raw };
    calls.push(call);
    const { status, body } = respond(call) ?? { status: 200, body: { QueryResponse: {} } };
    return new Response(JSON.stringify(body ?? {}), { status, headers: { "Content-Type": "application/json" } });
  }) as Fetch;
}
const posts = (path: string) => calls.filter((c) => c.method === "POST" && c.path === path);
const fault = (code: string, message: string): Reply => ({ status: 400, body: { Fault: { Error: [{ Message: message, code }] } } });

async function connect(overrides: Record<string, unknown> = {}) {
  await service.from("integration_connections").upsert({
    provider: "quickbooks",
    status: "connected",
    access_token_enc: encrypt("access-1"),
    refresh_token_enc: encrypt("refresh-1"),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    external_account_id: "realm-9",
    config: { environment: "sandbox", item_id: "7", item_name: "Roofing Services", tax_code_id: null },
    last_error: null,
    ...overrides,
  });
}
const connection = async () => (await service.from("integration_connections").select("status, access_token_enc, refresh_token_enc, last_error").eq("provider", "quickbooks").single()).data!;

/** A won deal whose $10,000 estimate (30% deposit) produced a deposit and a final draft invoice. */
async function jobWithInvoices() {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const email = `books${n}@example.com`;
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Quinn", last_name: `Books${n}`, phone: `568${n}`, phone_e164: `+1331${n}`, email, address_line1: `${seq} Balance Ct`, postal_code: "62701", work_type: "roof_replacement", owner_id: salesId } as Json,
  });
  const lead = data as { opportunity_id: string; customer_id: string };
  customers.push(lead.customer_id);
  const estimateId = ((await sales.rpc("create_estimate", { p_opportunity_id: lead.opportunity_id })).data as { estimate_id: string }).estimate_id;
  await sales.rpc("save_estimate_lines", { p_estimate_id: estimateId, p_lines: [{ name: "Roof", quantity: "1", unit_price_cents: 1_000_000 }] as Json });
  const path = `${lead.customer_id}/${lead.opportunity_id}/${randomUUID()}.pdf`;
  await service.storage.from(BUCKET).upload(path, Buffer.from("%PDF-1.4\n%%EOF\n"), { contentType: "application/pdf" });
  await sales.rpc("mark_estimate_sent", { p_estimate_id: estimateId, p_email: email, p_pdf_path: path });
  const won = (await sales.rpc("mark_opportunity_won", { p_opportunity_id: lead.opportunity_id, p_estimate_id: estimateId })).data as { job_id: string };
  const { data: invoices } = await service.from("invoices").select("id, kind").eq("job_id", won.job_id);
  return { dealId: lead.opportunity_id, customerId: lead.customer_id, email, name: `Quinn Books${n}`, address: `${seq} Balance Ct`, deposit: invoices!.find((i) => i.kind === "deposit")!.id };
}
const invoice = async (id: string) => (await service.from("invoices").select("*").eq("id", id).single()).data!;
const queue = async (id: string) => expect((await admin.rpc("queue_invoice_sync", { p_invoice_id: id })).data).toMatchObject({ ok: true });
const payments = async (dealId: string) => (await service.from("activities").select("summary, metadata").eq("opportunity_id", dealId).eq("type", "payment_received").order("created_at")).data!;

beforeAll(async () => {
  ({ client: admin } = await signInAs("admin@test.local"));
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
});

beforeEach(async () => {
  calls = [];
  await connect();
  // Start each test with nothing queued from the previous one.
  await service.from("sync_outbox").update({ status: "done" }).in("status", ["pending", "processing"]);
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

describe("sending an invoice", () => {
  it("links a QuickBooks customer found by email instead of creating one, stores the ids, and marks the invoice sent", async () => {
    const { deposit, customerId, email } = await jobWithInvoices();
    await queue(deposit);
    expect((await invoice(deposit)).qbo_sync_status).toBe("pending");

    const result = await processOutbox(
      fakeIntuit((call) => {
        if (call.query?.includes("PrimaryEmailAddr")) return { status: 200, body: { QueryResponse: { Customer: [{ Id: "C-55" }] } } };
        if (call.method === "POST" && call.path === "/invoice") return { status: 200, body: { Invoice: { Id: "INV-900", DocNumber: "1042", TotalAmt: 3000 } } };
      }),
    );
    expect(result).toMatchObject({ done: 1, failed: 0 });

    expect(calls.find((c) => c.query?.includes("PrimaryEmailAddr"))?.query).toContain(`'${email}'`);
    expect(posts("/customer")).toHaveLength(0);
    const [sent] = posts("/invoice");
    // The CRM invoice id is Intuit's idempotency key; the amount is dollars from integer cents.
    expect(new URL(sent!.url).searchParams.get("requestid")).toBe(deposit);
    expect(sent!.body).toMatchObject({ CustomerRef: { value: "C-55" }, Line: [{ Amount: 3000, SalesItemLineDetail: { ItemRef: { value: "7" }, TaxCodeRef: { value: "NON" } } }] });

    expect(await invoice(deposit)).toMatchObject({ status: "sent", qbo_invoice_id: "INV-900", qbo_sync_status: "synced", qbo_sync_error: null });
    expect((await service.from("customers").select("qbo_customer_id").eq("id", customerId).single()).data?.qbo_customer_id).toBe("C-55");
  });

  it("retries a duplicate name (6240) once with the address added", async () => {
    const { deposit, name, address } = await jobWithInvoices();
    await queue(deposit);
    await processOutbox(
      fakeIntuit((call) => {
        if (call.method === "POST" && call.path === "/customer") {
          return call.body?.DisplayName === name ? fault("6240", "Duplicate Name Exists Error") : { status: 200, body: { Customer: { Id: "C-77" } } };
        }
        if (call.method === "POST" && call.path === "/invoice") return { status: 200, body: { Invoice: { Id: "INV-901", DocNumber: "1043", TotalAmt: 3000 } } };
      }),
    );
    expect(posts("/customer").map((c) => c.body?.DisplayName)).toEqual([name, `${name} — ${address}`]);
    expect(await invoice(deposit)).toMatchObject({ status: "sent", qbo_invoice_id: "INV-901" });
  });

  it("a second worker run creates no second invoice", async () => {
    const { deposit } = await jobWithInvoices();
    await queue(deposit);
    const intuit = fakeIntuit((call) => {
      if (call.method === "POST" && call.path === "/customer") return { status: 200, body: { Customer: { Id: "C-78" } } };
      if (call.method === "POST" && call.path === "/invoice") return { status: 200, body: { Invoice: { Id: "INV-902", DocNumber: "1044", TotalAmt: 3000 } } };
    });
    await processOutbox(intuit);
    // Even a stray duplicate job for the same invoice does nothing once the invoice is in QuickBooks.
    await service.from("sync_outbox").insert({ provider: "quickbooks", entity_type: "invoice", entity_id: deposit });
    await processOutbox(intuit);
    expect(posts("/invoice")).toHaveLength(1);
    expect((await admin.rpc("queue_invoice_sync", { p_invoice_id: deposit })).data).toMatchObject({ ok: false, code: "not_draft" });
  });

  it("a validation error from QuickBooks fails at once and is shown on the invoice", async () => {
    const { deposit } = await jobWithInvoices();
    await queue(deposit);
    const result = await processOutbox(
      fakeIntuit((call) => {
        if (call.method === "POST" && call.path === "/customer") return { status: 200, body: { Customer: { Id: "C-79" } } };
        if (call.method === "POST" && call.path === "/invoice") return fault("2500", "Invalid Reference Id");
      }),
    );
    expect(result).toMatchObject({ failed: 1, retried: 0 });
    const row = await invoice(deposit);
    expect(row).toMatchObject({ status: "draft", qbo_sync_status: "error", qbo_invoice_id: null });
    expect(row.qbo_sync_error).toContain("Invalid Reference Id");
    // The admin can send it again after fixing the cause.
    await queue(deposit);
  });
});

describe("payments", () => {
  it("moves sent → partially paid → paid, logging one payment per increase and none when nothing changed", async () => {
    const { deposit, dealId } = await jobWithInvoices();
    await service.rpc("complete_invoice_sync", { p_invoice_id: deposit, p_qbo_invoice_id: `PAY-${deposit}`, p_doc_number: "2001" });
    let balance = 3000;
    const intuit = fakeIntuit((call) => {
      if (call.query?.includes("from Invoice")) {
        // Other tests' open invoices are simply reported as untouched.
        const ids = [...call.query.matchAll(/'([^']+)'/g)].map((m) => m[1]);
        return { status: 200, body: { QueryResponse: { Invoice: ids.map((Id) => ({ Id, TotalAmt: 3000, Balance: Id === `PAY-${deposit}` ? balance : 3000 })) } } };
      }
    });

    await pullPayments(intuit);
    expect(await invoice(deposit)).toMatchObject({ status: "sent", amount_paid_cents: 0 });

    balance = 2000;
    await pullPayments(intuit);
    expect(await invoice(deposit)).toMatchObject({ status: "partially_paid", amount_paid_cents: 100_000 });
    await pullPayments(intuit);
    expect(await payments(dealId)).toHaveLength(1);

    balance = 0;
    await pullPayments(intuit);
    const paid = await invoice(deposit);
    expect(paid).toMatchObject({ status: "paid", amount_paid_cents: 300_000 });
    expect(paid.paid_at).not.toBeNull();
    const logged = await payments(dealId);
    expect(logged).toHaveLength(2);
    // Amounts live in metadata, never in the summary (rule 13).
    for (const entry of logged) expect(entry.summary).not.toMatch(/\$|\d[\d,]*\.\d{2}|1,?000|2,?000|3,?000/);
  });
});

describe("the connection", () => {
  it("saves the rotated refresh token when the access token is refreshed", async () => {
    const { deposit } = await jobWithInvoices();
    await connect({ expires_at: new Date(Date.now() - 60_000).toISOString() });
    await queue(deposit);
    await processOutbox(
      fakeIntuit((call) => {
        if (call.url.includes("oauth2/v1/tokens")) return { status: 200, body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 } };
        if (call.method === "POST" && call.path === "/customer") return { status: 200, body: { Customer: { Id: "C-80" } } };
        if (call.method === "POST" && call.path === "/invoice") return { status: 200, body: { Invoice: { Id: "INV-903", DocNumber: "1045", TotalAmt: 3000 } } };
      }),
    );
    const refreshes = calls.filter((c) => c.url.includes("oauth2/v1/tokens"));
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });
    const saved = await connection();
    expect([decrypt(saved.access_token_enc!), decrypt(saved.refresh_token_enc!)]).toEqual(["access-2", "refresh-2"]);
    expect(await invoice(deposit)).toMatchObject({ status: "sent", qbo_invoice_id: "INV-903" });
  });

  it("invalid_grant marks the connection as needing a reconnect and keeps the invoice waiting", async () => {
    const { deposit } = await jobWithInvoices();
    await connect({ expires_at: new Date(Date.now() - 60_000).toISOString() });
    await queue(deposit);
    await processOutbox(fakeIntuit((call) => (call.url.includes("oauth2/v1/tokens") ? { status: 400, body: { error: "invalid_grant" } } : undefined)));

    const broken = await connection();
    expect(broken.status).toBe("error");
    expect(broken.last_error).toContain("Reconnect QuickBooks");
    expect(posts("/invoice")).toHaveLength(0);
    // Nothing was lost: the invoice is still a draft that has not reached QuickBooks.
    expect(await invoice(deposit)).toMatchObject({ status: "draft", qbo_invoice_id: null });
  });
});

describe("connecting a different company", () => {
  it("is refused while customers or invoices are linked to the current one, and allowed for the same company", async () => {
    const { customerId } = await jobWithInvoices();
    await service.from("customers").update({ qbo_customer_id: "C-1" }).eq("id", customerId);
    expect(await linkedToOtherCompany("realm-9")).toBe(false);
    expect(await linkedToOtherCompany("realm-10")).toBe(true);
    // The company id survives a disconnect, so the rule still holds afterwards.
    await connect({ status: "disconnected", access_token_enc: null, refresh_token_enc: null });
    expect(await linkedToOtherCompany("realm-10")).toBe(true);
  });
});
