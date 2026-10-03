import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtures, PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";

// Lifecycle rules cannot be bypassed by talking to the API directly (spec §2.10).
// Column privileges are checked before any row is touched, so these fail even for an admin.

let fx: Awaited<ReturnType<typeof loadFixtures>>;
let admin: Client, sales: Client;
let salesId: string;
const service = serviceClient();

beforeAll(async () => {
  fx = await loadFixtures();
  ({ client: admin } = await signInAs("admin@test.local"));
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
});

describe("direct writes to lifecycle columns are denied", () => {
  const now = new Date().toISOString();
  const cases: [string, (c: Client) => PromiseLike<{ error: { code: string } | null }>][] = [
    ["opportunities.stage", (c) => c.from("opportunities").update({ stage: "won" }).eq("id", fx.unassignedDeal.id)],
    ["opportunities.amount_cents", (c) => c.from("opportunities").update({ amount_cents: 1 }).eq("id", fx.unassignedDeal.id)],
    ["opportunities.owner_id", (c) => c.from("opportunities").update({ owner_id: salesId }).eq("id", fx.unassignedDeal.id)],
    ["opportunities.won_at", (c) => c.from("opportunities").update({ won_at: now }).eq("id", fx.unassignedDeal.id)],
    ["estimates.status", (c) => c.from("estimates").update({ status: "accepted" }).eq("opportunity_id", fx.estimateDeal.id)],
    ["estimates.total_cents", (c) => c.from("estimates").update({ total_cents: 1 }).eq("opportunity_id", fx.estimateDeal.id)],
    ["estimate_line_items insert", (c) => c.from("estimate_line_items").insert({ estimate_id: fx.estimateDeal.id, name: "x", unit_price_cents: 1 })],
    ["jobs.status", (c) => c.from("jobs").update({ status: "completed" }).eq("id", fx.jobId)],
    ["appointments.starts_at", (c) => c.from("appointments").update({ starts_at: now }).eq("opportunity_id", fx.inspectionDeal.id)],
    ["appointments.status", (c) => c.from("appointments").update({ status: "completed" }).eq("opportunity_id", fx.inspectionDeal.id)],
    ["invoices.total_cents", (c) => c.from("invoices").update({ total_cents: 1 }).eq("job_id", fx.jobId)],
    ["invoices.status", (c) => c.from("invoices").update({ status: "paid" }).eq("job_id", fx.jobId)],
    ["files.storage_path", (c) => c.from("files").update({ storage_path: "elsewhere" }).eq("opportunity_id", fx.wonDeal.id)],
    ["tasks.status", (c) => c.from("tasks").update({ status: "done" }).eq("opportunity_id", fx.unassignedDeal.id)],
    ["profiles.email", (c) => c.from("profiles").update({ email: "x@test.local" }).eq("id", salesId)],
    ["activities insert", (c) => c.from("activities").insert({ type: "deal_won", customer_id: fx.wonDeal.customer_id, summary: "forged" })],
    ["files insert", (c) => c.from("files").insert({ customer_id: fx.wonDeal.customer_id, storage_path: "x", file_name: "x", mime_type: "x", size_bytes: 1 })],
    ["jobs insert", (c) => c.from("jobs").insert({ opportunity_id: fx.unassignedDeal.id, customer_id: fx.unassignedDeal.customer_id, property_id: fx.unassignedDeal.property_id!, title: "x", work_type: "other" })],
  ];

  it.each(cases)("%s (sales)", async (_name, run) => {
    const { error } = await run(sales);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(cases)("%s (admin)", async (_name, run) => {
    const { error } = await run(admin);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("left the data untouched", async () => {
    const { data: deal } = await service.from("opportunities").select("stage, amount_cents").eq("id", fx.unassignedDeal.id).single();
    expect(deal).toEqual({ stage: "qualified", amount_cents: null });
    const { data: forged } = await service.from("activities").select("id").eq("summary", "forged");
    expect(forged).toHaveLength(0);
  });
});
