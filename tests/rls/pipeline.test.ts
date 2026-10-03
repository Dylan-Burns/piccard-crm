import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/types/database";
import { PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";

type Result = { ok: boolean; code?: string; missing?: string[]; job_id?: string; job_number?: number; already?: boolean; stage?: string };
let sales: Client, field: Client;
let salesId: string;
const service = serviceClient();
const customers: string[] = [];
let seq = 0;

/** A fresh lead via create_lead. Options control what the gates will find missing. */
async function newDeal(options: { owner?: boolean; workType?: boolean; address?: boolean } = {}) {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const { data } = await service.rpc("create_lead", {
    p: {
      channel: "website", first_name: "Pipe", last_name: `Line${n}`, phone: `555${n}`, phone_e164: `+1312${n}`,
      ...(options.address === false ? {} : { address_line1: `${seq} Gate St`, postal_code: "62701" }),
      ...(options.workType === false ? {} : { work_type: "roof_replacement" }),
      ...(options.owner === false ? {} : { owner_id: salesId }),
    } as Json,
  });
  const result = data as { opportunity_id: string; customer_id: string };
  customers.push(result.customer_id);
  return result.opportunity_id;
}
const rpc = async (client: Client, fn: "change_opportunity_stage" | "mark_opportunity_won" | "mark_opportunity_lost" | "reopen_opportunity", args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args as never);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as Result;
};
const deal = async (id: string) => (await service.from("opportunities").select("*").eq("id", id).single()).data!;
const openTaskKeys = async (id: string) =>
  (await service.from("tasks").select("auto_key").eq("opportunity_id", id).eq("status", "open")).data!.map((t) => t.auto_key).sort();

/** Inserts a sent estimate with one taxable line. */
async function sentEstimate(opportunityId: string, opts: { taxRate: number; depositPercent: number; cents: number }) {
  const { data: estimate } = await service.from("estimates")
    .insert({ opportunity_id: opportunityId, title: "Roof", tax_rate: opts.taxRate, deposit_percent: opts.depositPercent }).select("id").single();
  await service.from("estimate_line_items").insert([
    { estimate_id: estimate!.id, sort_order: 1, name: "Shingles", quantity: 28, unit: "sq", unit_price_cents: Math.round(opts.cents / 28), is_taxable: true },
    { estimate_id: estimate!.id, sort_order: 2, name: "Ridge vent", quantity: 40.5, unit: "lf", unit_price_cents: 100, is_taxable: true },
  ]);
  await service.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", estimate!.id);
  return estimate!.id;
}

beforeAll(async () => {
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field } = await signInAs("field@test.local"));
});
afterAll(async () => {
  for (const id of customers) {
    const { data: opps } = await service.from("opportunities").select("id").eq("customer_id", id);
    for (const o of opps ?? []) {
      const { data: jobs } = await service.from("jobs").select("id").eq("opportunity_id", o.id);
      for (const j of jobs ?? []) {
        await service.from("invoices").delete().eq("job_id", j.id);
        await service.from("jobs").delete().eq("id", j.id);
      }
    }
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
});

describe("change_opportunity_stage", () => {
  it("moves between open stages when the gate passes and runs entry automation", async () => {
    const id = await newDeal();
    expect(await rpc(sales, "change_opportunity_stage", { p_opportunity_id: id, p_to_stage: "contacted" })).toMatchObject({ ok: true });
    expect(await openTaskKeys(id)).toEqual(["qualify"]);
    expect(await rpc(sales, "change_opportunity_stage", { p_opportunity_id: id, p_to_stage: "qualified" })).toMatchObject({ ok: true });
    expect(await openTaskKeys(id)).toEqual(["schedule_inspection"]);
    // moving backward is always allowed
    expect(await rpc(sales, "change_opportunity_stage", { p_opportunity_id: id, p_to_stage: "new" })).toMatchObject({ ok: true });
    expect((await deal(id)).stage).toBe("new");
  });

  it("reports exactly what is missing", async () => {
    const id = await newDeal({ owner: false, workType: false, address: false });
    expect(await rpc(sales, "change_opportunity_stage", { p_opportunity_id: id, p_to_stage: "contacted" }))
      .toMatchObject({ ok: false, code: "missing_requirements", missing: ["owner"] });
    expect(await rpc(sales, "change_opportunity_stage", { p_opportunity_id: id, p_to_stage: "qualified" }))
      .toMatchObject({ ok: false, missing: ["owner", "work_type", "property"] });
    expect((await deal(id)).stage).toBe("new");
  });

  it("accepts the missing data and moves in one call", async () => {
    const id = await newDeal({ owner: false, workType: false, address: false });
    const result = await rpc(sales, "change_opportunity_stage", {
      p_opportunity_id: id, p_to_stage: "qualified",
      p_fill: { owner_id: salesId, work_type: "gutters", address_line1: "42 Filled In Rd", postal_code: "62702" },
    });
    expect(result).toMatchObject({ ok: true, stage: "qualified" });
    const d = await deal(id);
    expect(d).toMatchObject({ stage: "qualified", owner_id: salesId, work_type: "gutters" });
    expect(d.property_id).toBeTruthy();
  });

  it("needs an inspection for Inspection Scheduled and a sent estimate for Estimate Sent", async () => {
    const id = await newDeal();
    expect(await rpc(sales, "change_opportunity_stage", { p_opportunity_id: id, p_to_stage: "inspection_scheduled" }))
      .toMatchObject({ ok: false, missing: ["inspection"] });
    expect(await rpc(sales, "change_opportunity_stage", { p_opportunity_id: id, p_to_stage: "estimate_sent" }))
      .toMatchObject({ ok: false, missing: ["estimate"] });
  });

  it("refuses won and lost, and is denied to field users", async () => {
    const id = await newDeal();
    expect(await rpc(sales, "change_opportunity_stage", { p_opportunity_id: id, p_to_stage: "won" }))
      .toMatchObject({ ok: false, code: "use_dedicated_action" });
    const denied = await field.rpc("change_opportunity_stage", { p_opportunity_id: id, p_to_stage: "contacted" });
    expect(denied.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("mark_opportunity_won", () => {
  it("with an amount: creates the job, closes the deal, swaps the tasks, and is idempotent", async () => {
    const id = await newDeal();
    expect(await rpc(sales, "mark_opportunity_won", { p_opportunity_id: id })).toMatchObject({ ok: false, code: "amount_required" });

    const won = await rpc(sales, "mark_opportunity_won", { p_opportunity_id: id, p_amount_cents: 1250000 });
    expect(won.ok).toBe(true);
    expect(won.job_number).toBeGreaterThan(1000);

    const d = await deal(id);
    expect(d).toMatchObject({ stage: "won", amount_cents: 1250000, closed_owner_id: salesId, closed_by: salesId });
    expect(d.won_at).toBeTruthy();

    const { data: job } = await service.from("jobs").select("status, work_type, property_id, warranty_years, customer_id").eq("id", won.job_id!).single();
    expect(job).toMatchObject({ status: "pending_schedule", work_type: "roof_replacement", warranty_years: 5, property_id: d.property_id });

    expect(await openTaskKeys(id)).toEqual(["collect_contract", "order_materials", "permit", "schedule_job"]);
    const { data: jobTasks } = await service.from("tasks").select("job_id").eq("opportunity_id", id).eq("status", "open");
    expect(jobTasks!.every((t) => t.job_id === won.job_id)).toBe(true);
    const { data: cancelled } = await service.from("tasks").select("auto_key").eq("opportunity_id", id).eq("status", "cancelled");
    expect(cancelled!.map((t) => t.auto_key)).toEqual(["first_contact"]);

    const { data: acts } = await service.from("activities").select("type, summary").eq("opportunity_id", id).in("type", ["deal_won", "job_created"]);
    expect(acts!.map((a) => a.type).sort()).toEqual(["deal_won", "job_created"]);
    expect(acts!.every((a) => !a.summary.includes("$"))).toBe(true);
    const { data: invoices } = await service.from("invoices").select("id").eq("job_id", won.job_id!);
    expect(invoices).toHaveLength(0); // no estimate → no invoices

    const again = await rpc(sales, "mark_opportunity_won", { p_opportunity_id: id, p_amount_cents: 999 });
    expect(again).toMatchObject({ ok: true, already: true, job_id: won.job_id });
    expect((await deal(id)).amount_cents).toBe(1250000);
  });

  it("with an estimate: accepts it, writes a price-free scope, and splits deposit and final exactly", async () => {
    const id = await newDeal();
    const estimateId = await sentEstimate(id, { taxRate: 0.0825, depositPercent: 30, cents: 2_480_000 });
    const other = (await service.from("estimates").insert({ opportunity_id: id, title: "Draft alt" }).select("id").single()).data!.id;
    const { data: est } = await service.from("estimates").select("total_cents, tax_cents, deposit_cents").eq("id", estimateId).single();

    expect(await rpc(sales, "mark_opportunity_won", { p_opportunity_id: id, p_amount_cents: 5 })).toMatchObject({ ok: false, code: "choose_estimate" });
    const won = await rpc(sales, "mark_opportunity_won", { p_opportunity_id: id, p_estimate_id: estimateId });
    expect(won.ok).toBe(true);

    expect((await deal(id)).amount_cents).toBe(est!.total_cents);
    const { data: statuses } = await service.from("estimates").select("id, status").eq("opportunity_id", id);
    expect(Object.fromEntries(statuses!.map((s) => [s.id, s.status]))).toEqual({ [estimateId]: "accepted", [other]: "void" });

    const { data: job } = await service.from("jobs").select("scope_summary, accepted_estimate_id").eq("id", won.job_id!).single();
    expect(job!.accepted_estimate_id).toBe(estimateId);
    expect(job!.scope_summary).toBe("28 sq  Shingles\n40.5 lf  Ridge vent");
    expect(job!.scope_summary).not.toMatch(/\$|\d{4,}/);

    const { data: invoices } = await service.from("invoices").select("kind, status, subtotal_cents, tax_cents, total_cents, invoice_line_items(amount_cents, description)").eq("job_id", won.job_id!).order("kind");
    expect(invoices!.map((i) => i.kind)).toEqual(["deposit", "final"]);
    const [deposit, final] = invoices!;
    expect(deposit!.total_cents).toBe(est!.deposit_cents);
    expect(deposit!.total_cents + final!.total_cents).toBe(est!.total_cents);
    expect(deposit!.tax_cents + final!.tax_cents).toBe(est!.tax_cents);
    for (const invoice of invoices!) {
      expect(invoice.status).toBe("draft");
      expect(invoice.subtotal_cents + invoice.tax_cents).toBe(invoice.total_cents);
      expect(invoice.invoice_line_items).toHaveLength(1);
      expect(invoice.invoice_line_items[0]!.amount_cents).toBe(invoice.subtotal_cents);
    }
    expect(deposit!.invoice_line_items[0]!.description).toMatch(/^Deposit \(30%\) — Roof \(E-\d+\)$/);
  });

  it("creates a single final invoice when there is no deposit", async () => {
    const id = await newDeal();
    const estimateId = await sentEstimate(id, { taxRate: 0, depositPercent: 0, cents: 500_000 });
    const won = await rpc(sales, "mark_opportunity_won", { p_opportunity_id: id, p_estimate_id: estimateId });
    const { data: invoices } = await service.from("invoices").select("kind, total_cents").eq("job_id", won.job_id!);
    expect(invoices).toHaveLength(1);
    expect(invoices![0]!.kind).toBe("final");
  });

  it("is blocked by missing requirements and by a lost deal", async () => {
    const bare = await newDeal({ owner: false, workType: false, address: false });
    expect(await rpc(sales, "mark_opportunity_won", { p_opportunity_id: bare, p_amount_cents: 100 }))
      .toMatchObject({ ok: false, code: "missing_requirements", missing: ["owner", "work_type", "property"] });
    const lost = await newDeal();
    await rpc(sales, "mark_opportunity_lost", { p_opportunity_id: lost, p_reason: "price" });
    expect(await rpc(sales, "mark_opportunity_won", { p_opportunity_id: lost, p_amount_cents: 100 })).toMatchObject({ ok: false, code: "is_lost" });
  });
});

describe("mark_opportunity_lost and reopen", () => {
  it("requires a reason (and notes for 'other'), then closes everything open on the deal", async () => {
    const id = await newDeal();
    const estimateId = await sentEstimate(id, { taxRate: 0, depositPercent: 0, cents: 100_000 });
    const { data: appt } = await service.from("appointments")
      .insert({ type: "inspection", title: "Inspection", opportunity_id: id, customer_id: (await deal(id)).customer_id, assigned_to: salesId, starts_at: "2031-01-01T15:00:00Z", ends_at: "2031-01-01T16:00:00Z" }).select("id").single();

    expect(await rpc(sales, "mark_opportunity_lost", { p_opportunity_id: id, p_reason: "other" })).toMatchObject({ ok: false, code: "notes_required" });
    expect(await rpc(sales, "mark_opportunity_lost", { p_opportunity_id: id, p_reason: "competitor", p_competitor: "Acme Roofing" })).toMatchObject({ ok: true });

    const d = await deal(id);
    expect(d).toMatchObject({ stage: "lost", lost_reason: "competitor", lost_competitor: "Acme Roofing", closed_owner_id: salesId, closed_by: salesId });
    expect((await service.from("appointments").select("status").eq("id", appt!.id).single()).data!.status).toBe("cancelled");
    expect((await service.from("estimates").select("status").eq("id", estimateId).single()).data!.status).toBe("void");
    expect(await openTaskKeys(id)).toEqual([]);

    // reopen
    expect(await rpc(sales, "reopen_opportunity", { p_opportunity_id: id, p_to_stage: "estimate_sent" }))
      .toMatchObject({ ok: false, code: "missing_requirements" }); // its estimate was voided
    expect(await rpc(sales, "reopen_opportunity", { p_opportunity_id: id, p_to_stage: "qualified" })).toMatchObject({ ok: true });
    const reopened = await deal(id);
    expect(reopened).toMatchObject({ stage: "qualified", lost_reason: null, lost_at: null, closed_owner_id: null, closed_by: null });
    expect(await openTaskKeys(id)).toEqual(["reopened_followup"]);
  });

  it("cannot mark a won deal lost", async () => {
    const id = await newDeal();
    await rpc(sales, "mark_opportunity_won", { p_opportunity_id: id, p_amount_cents: 100_000 });
    expect(await rpc(sales, "mark_opportunity_lost", { p_opportunity_id: id, p_reason: "price" })).toMatchObject({ ok: false, code: "is_won" });
  });
});
