import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/types/database";
import { PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";

type Result = { ok: boolean; code?: string; missing?: string[]; appointment_id?: string };
let sales: Client, field: Client, field2: Client;
let salesId: string, fieldId: string;
const service = serviceClient();
const customers: string[] = [];
let seq = 0;

async function newDeal(options: { owner?: boolean; stage?: string } = {}) {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Appt", last_name: `Test${n}`, phone: `555${n}`, phone_e164: `+1773${n}`, address_line1: `${seq} Visit St`, postal_code: "62701", work_type: "roof_repair", ...(options.owner === false ? {} : { owner_id: salesId }) } as Json,
  });
  const r = data as { opportunity_id: string; customer_id: string };
  customers.push(r.customer_id);
  if (options.stage) await sales.rpc("change_opportunity_stage", { p_opportunity_id: r.opportunity_id, p_to_stage: options.stage as never });
  return r.opportunity_id;
}
const schedule = async (client: Client, input: Record<string, unknown>) => {
  const { data, error } = await client.rpc("schedule_appointment", { p: input as Json });
  if (error) throw new Error(error.message);
  return data as Result;
};
const inspection = (opportunityId: string, extra: Record<string, unknown> = {}) => ({
  opportunity_id: opportunityId, type: "inspection", starts_at: "2031-03-04T15:00:00Z", ends_at: "2031-03-04T16:00:00Z", assigned_to: fieldId, ...extra,
});
const stage = async (id: string) => (await service.from("opportunities").select("stage").eq("id", id).single()).data!.stage;
const openKeys = async (id: string) => (await service.from("tasks").select("auto_key").eq("opportunity_id", id).eq("status", "open")).data!.map((t) => t.auto_key).sort();

beforeAll(async () => {
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field, userId: fieldId } = await signInAs("field@test.local"));
  ({ client: field2 } = await signInAs("field2@test.local"));
});
afterAll(async () => {
  for (const id of customers) {
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
});

describe("schedule_appointment", () => {
  it("scheduling an inspection moves a qualified deal to Inspection Scheduled and closes the scheduling task", async () => {
    const id = await newDeal({ stage: "qualified" });
    expect(await openKeys(id)).toContain("schedule_inspection");
    const result = await schedule(sales, inspection(id, { notes: "Bring a ladder" }));
    expect(result.ok).toBe(true);
    expect(await stage(id)).toBe("inspection_scheduled");
    expect(await openKeys(id)).not.toContain("schedule_inspection");

    const { data: appt } = await service.from("appointments").select("title, customer_id, property_id, assigned_to, notes, status, created_by").eq("id", result.appointment_id!).single();
    expect(appt).toMatchObject({ assigned_to: fieldId, notes: "Bring a ladder", status: "scheduled", created_by: salesId });
    expect(appt!.title).toMatch(/^Inspection: Appt Test/);
    expect(appt!.property_id).toBeTruthy();
    const { data: acts } = await service.from("activities").select("type").eq("opportunity_id", id).eq("type", "appointment_scheduled");
    expect(acts).toHaveLength(1);
  });

  it("works straight from New when the deal has what Qualified needs", async () => {
    const id = await newDeal();
    expect((await schedule(sales, inspection(id))).ok).toBe(true);
    expect(await stage(id)).toBe("inspection_scheduled");
  });

  it("inserts nothing when the deal is missing requirements", async () => {
    const id = await newDeal({ owner: false });
    expect(await schedule(sales, inspection(id))).toMatchObject({ ok: false, code: "missing_requirements", missing: ["owner"] });
    const { count } = await service.from("appointments").select("id", { count: "exact", head: true }).eq("opportunity_id", id);
    expect(count).toBe(0);
    expect(await stage(id)).toBe("new");
  });

  it("validates times and is denied to field users", async () => {
    const id = await newDeal();
    expect(await schedule(sales, inspection(id, { ends_at: "2031-03-04T14:00:00Z" }))).toMatchObject({ ok: false, code: "invalid" });
    const denied = await field.rpc("schedule_appointment", { p: inspection(id) as Json });
    expect(denied.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("complete, cancel, reschedule", () => {
  it("the assigned field user completes their inspection; the owner gets the estimate task", async () => {
    const id = await newDeal();
    const { appointment_id } = await schedule(sales, inspection(id));

    // not theirs / wrong status / direct write
    expect((await field2.rpc("complete_appointment", { p_appointment_id: appointment_id!, p_status: "completed" })).error?.code).toBe(PERMISSION_DENIED);
    expect((await field.rpc("cancel_appointment", { p_appointment_id: appointment_id! })).error?.code).toBe(PERMISSION_DENIED);
    expect((await field.rpc("reschedule_appointment", { p_appointment_id: appointment_id!, p_starts_at: "2031-03-05T15:00:00Z", p_ends_at: "2031-03-05T16:00:00Z" })).error?.code).toBe(PERMISSION_DENIED);
    expect((await field.from("appointments").update({ starts_at: "2031-03-05T15:00:00Z" }).eq("id", appointment_id!)).error?.code).toBe(PERMISSION_DENIED);
    expect((await field.rpc("complete_appointment", { p_appointment_id: appointment_id!, p_status: "cancelled" })).data).toMatchObject({ ok: false, code: "invalid" });

    const { data } = await field.rpc("complete_appointment", { p_appointment_id: appointment_id!, p_status: "completed", p_outcome_notes: "Two layers, soft decking by chimney" });
    expect(data).toMatchObject({ ok: true });
    const { data: appt } = await service.from("appointments").select("status, outcome_notes, completed_at").eq("id", appointment_id!).single();
    expect(appt).toMatchObject({ status: "completed", outcome_notes: "Two layers, soft decking by chimney" });
    expect(appt!.completed_at).toBeTruthy();

    const { data: task } = await service.from("tasks").select("assigned_to").eq("opportunity_id", id).eq("auto_key", "send_estimate").eq("status", "open").single();
    expect(task!.assigned_to).toBe(salesId);
    expect(await stage(id)).toBe("inspection_scheduled"); // stays; a completed inspection still satisfies the gate
    expect((await field.rpc("complete_appointment", { p_appointment_id: appointment_id!, p_status: "completed" })).data).toMatchObject({ ok: false, code: "not_scheduled" });
  });

  it("cancelling the only inspection sends the deal back to Qualified", async () => {
    const id = await newDeal();
    const { appointment_id } = await schedule(sales, inspection(id));
    expect((await sales.rpc("cancel_appointment", { p_appointment_id: appointment_id!, p_reason: "Customer rescheduling" })).data).toMatchObject({ ok: true });
    expect(await stage(id)).toBe("qualified");
    expect(await openKeys(id)).toContain("schedule_inspection");
    const { data: appt } = await service.from("appointments").select("status, outcome_notes").eq("id", appointment_id!).single();
    expect(appt).toEqual({ status: "cancelled", outcome_notes: "Customer rescheduling" });
  });

  it("a no-show does the same, but a second scheduled inspection keeps the stage", async () => {
    const id = await newDeal();
    const first = await schedule(sales, inspection(id));
    const second = await schedule(sales, inspection(id, { starts_at: "2031-03-06T15:00:00Z", ends_at: "2031-03-06T16:00:00Z" }));
    await field.rpc("complete_appointment", { p_appointment_id: first.appointment_id!, p_status: "no_show" });
    expect(await stage(id)).toBe("inspection_scheduled");
    await field.rpc("complete_appointment", { p_appointment_id: second.appointment_id!, p_status: "no_show" });
    expect(await stage(id)).toBe("qualified");
  });

  it("rescheduling logs the change and only works on scheduled appointments", async () => {
    const id = await newDeal();
    const { appointment_id } = await schedule(sales, inspection(id));
    const moved = await sales.rpc("reschedule_appointment", { p_appointment_id: appointment_id!, p_starts_at: "2031-03-10T18:00:00Z", p_ends_at: "2031-03-10T19:00:00Z", p_assigned_to: salesId });
    expect(moved.data).toMatchObject({ ok: true });
    const { data: appt } = await service.from("appointments").select("starts_at, assigned_to").eq("id", appointment_id!).single();
    expect(new Date(appt!.starts_at).toISOString()).toBe("2031-03-10T18:00:00.000Z");
    expect(appt!.assigned_to).toBe(salesId);
    const { data: acts } = await service.from("activities").select("metadata").eq("opportunity_id", id).eq("type", "appointment_rescheduled");
    expect(acts).toHaveLength(1);

    await sales.rpc("cancel_appointment", { p_appointment_id: appointment_id! });
    const again = await sales.rpc("reschedule_appointment", { p_appointment_id: appointment_id!, p_starts_at: "2031-03-11T18:00:00Z", p_ends_at: "2031-03-11T19:00:00Z" });
    expect(again.data).toMatchObject({ ok: false, code: "not_scheduled" });
  });
});
