import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUCKET } from "@/features/files/categories";
import { notifyDealWon, notifyEstimateDecision } from "@/features/estimates/notify";
import { resendEstimateEmailFlow, sendEstimateFlow } from "@/features/estimates/send";
import type { Sender } from "@/lib/integrations/resend";
import type { Json } from "@/types/database";
import { serviceClient, signInAs, type Client } from "./helpers";

// The send action's flow and the follow-up emails, with a fake sender instead of Resend.
let sales: Client, field: Client;
let salesId: string, salesEmail: string;
const service = serviceClient();
const customers: string[] = [];
const sent: { to: string; subject: string; html: string }[] = [];
const sender: Sender = async (message) => {
  sent.push(message);
  return { id: `fake-${sent.length}` };
};
let seq = 0;

async function draftFor(email: string | null) {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Send", last_name: `Flow${n}`, phone: `561${n}`, phone_e164: `+1815${n}`, ...(email ? { email } : {}), address_line1: `${seq} Mail Rd`, postal_code: "62701", work_type: "roof_repair", owner_id: salesId } as Json,
  });
  const lead = data as { opportunity_id: string; customer_id: string };
  customers.push(lead.customer_id);
  const created = (await sales.rpc("create_estimate", { p_opportunity_id: lead.opportunity_id })).data as { estimate_id: string };
  await sales.rpc("save_estimate_lines", { p_estimate_id: created.estimate_id, p_lines: [{ name: "Repair", quantity: "1", unit_price_cents: 250_000 }] as Json });
  return { dealId: lead.opportunity_id, estimateId: created.estimate_id };
}

beforeAll(async () => {
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field } = await signInAs("field@test.local"));
  salesEmail = (await service.from("profiles").select("email").eq("id", salesId).single()).data!.email;
});

afterAll(async () => {
  for (const id of customers) {
    const { data: rows } = await service.from("files").select("storage_path").eq("customer_id", id);
    if (rows?.length) await service.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
    const { data: jobs } = await service.from("jobs").select("id").eq("customer_id", id);
    for (const j of jobs ?? []) {
      await service.from("invoices").delete().eq("job_id", j.id);
      await service.from("jobs").delete().eq("id", j.id);
    }
    await service.from("email_log").delete().in("opportunity_id", (await service.from("opportunities").select("id").eq("customer_id", id)).data!.map((o) => o.id));
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
});

describe("sendEstimateFlow", () => {
  it("stores the PDF, marks the estimate sent, and emails the customer the link", async () => {
    const email = `send${Date.now()}@example.com`;
    const { dealId, estimateId } = await draftFor(email);
    sent.length = 0;
    const result = await sendEstimateFlow(sales, estimateId, { send: sender });
    expect(result).toMatchObject({ ok: true, data: { email: "sent", to: email } });

    const { data: e } = await service.from("estimates").select("status, pdf_path, public_token, sent_to_email").eq("id", estimateId).single();
    expect(e).toMatchObject({ status: "sent", sent_to_email: email });
    expect(result.ok && result.data.publicUrl.endsWith(`/e/${e!.public_token}`)).toBe(true);

    // The stored snapshot is a real PDF, registered as an estimate file
    const { data: blob } = await service.storage.from(BUCKET).download(e!.pdf_path!);
    expect(Buffer.from(await blob!.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await service.from("files").select("category").eq("opportunity_id", dealId)).data).toEqual([{ category: "estimate" }]);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email });
    expect(sent[0]!.html).toContain(`/e/${e!.public_token}`);
    expect(sent[0]!.html).not.toMatch(/\$\s?2,500/); // the email carries the link, not the price

    // Sending again is refused; an explicit resend sends one more email with the same link
    expect(await sendEstimateFlow(sales, estimateId, { send: sender })).toMatchObject({ ok: false, error: { code: "not_draft" } });
    expect(await resendEstimateEmailFlow(sales, estimateId, sender)).toMatchObject({ ok: true, data: { email: "sent", to: email } });
    expect(sent).toHaveLength(2);
    expect((await service.storage.from(BUCKET).list(e!.pdf_path!.split("/").slice(0, 2).join("/"))).data).toHaveLength(1); // no stray PDFs
  });

  it("needs a customer email and at least one priced line, and field users cannot send", async () => {
    const noEmail = await draftFor(null);
    expect(await sendEstimateFlow(sales, noEmail.estimateId, { send: sender })).toMatchObject({ ok: false, error: { code: "no_email" } });

    const empty = await draftFor(`empty${Date.now()}@example.com`);
    await sales.rpc("save_estimate_lines", { p_estimate_id: empty.estimateId, p_lines: [] as Json });
    expect(await sendEstimateFlow(sales, empty.estimateId, { send: sender })).toMatchObject({ ok: false, error: { code: "empty" } });

    const ready = await draftFor(`ready${Date.now()}@example.com`);
    expect(await sendEstimateFlow(field, ready.estimateId, { send: sender })).toMatchObject({ ok: false, error: { code: "not_found" } }); // RLS: they cannot see it
    expect((await service.from("estimates").select("status").eq("id", ready.estimateId).single()).data!.status).toBe("draft");
  });

  it("an email failure leaves the estimate sent", async () => {
    const { estimateId } = await draftFor(`fail${Date.now()}@example.com`);
    const failing: Sender = async () => {
      throw new Error("provider down");
    };
    expect(await sendEstimateFlow(sales, estimateId, { send: failing })).toMatchObject({ ok: true, data: { email: "failed" } });
    expect((await service.from("estimates").select("status").eq("id", estimateId).single()).data!.status).toBe("sent");
  });
});

describe("decision emails", () => {
  it("approval emails the owner and every admin once; a decline emails the owner with the reason", async () => {
    const { dealId, estimateId } = await draftFor(`decide${Date.now()}@example.com`);
    await sendEstimateFlow(sales, estimateId, { send: sender });
    const token = (await service.from("estimates").select("public_token").eq("id", estimateId).single()).data!.public_token;
    await service.rpc("accept_estimate", { p_token: token, p_name: "Send Flow" });

    sent.length = 0;
    await notifyEstimateDecision(estimateId, "approved", sender);
    await notifyDealWon(dealId, sender);
    await notifyEstimateDecision(estimateId, "approved", sender); // repeated: already sent
    await notifyDealWon(dealId, sender);
    const { data: admins } = await service.from("profiles").select("email").eq("role", "admin").eq("is_active", true);
    expect(sent.filter((m) => m.to === salesEmail && /approved estimate E-\d+/.test(m.subject))).toHaveLength(1);
    expect(sent.filter((m) => m.subject.startsWith("Deal won"))).toHaveLength(admins!.length);
    expect(sent.every((m) => !/\$\s?\d/.test(m.html))).toBe(true); // no amounts (React adds "$" markers of its own)

    const declined = await draftFor(`no${Date.now()}@example.com`);
    await sendEstimateFlow(sales, declined.estimateId, { send: sender });
    const declinedToken = (await service.from("estimates").select("public_token").eq("id", declined.estimateId).single()).data!.public_token;
    await service.rpc("decline_estimate", { p_token: declinedToken, p_reason: "Too soon" });
    sent.length = 0;
    await notifyEstimateDecision(declined.estimateId, "declined", sender);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(salesEmail);
    expect(sent[0]!.html).toContain("Too soon");
  });
});
