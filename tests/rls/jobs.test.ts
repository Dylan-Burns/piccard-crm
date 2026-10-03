import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/types/database";
import { PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";

type Result = { ok: boolean; code?: string; already?: boolean };
let admin: Client, sales: Client, field: Client, field2: Client;
let salesId: string, fieldId: string, field2Id: string;
const service = serviceClient();
const customers: string[] = [];
let seq = 0;

/** A won deal (by amount) and its job. */
async function newJob() {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Job", last_name: `Site${n}`, phone: `557${n}`, phone_e164: `+1630${n}`, address_line1: `${seq} Ridge Rd`, postal_code: "62701", work_type: "roof_replacement", owner_id: salesId } as Json,
  });
  const lead = data as { opportunity_id: string; customer_id: string };
  customers.push(lead.customer_id);
  const { data: won, error } = await sales.rpc("mark_opportunity_won", { p_opportunity_id: lead.opportunity_id, p_amount_cents: 1_800_000 });
  if (error) throw new Error(error.message);
  return { jobId: (won as { job_id: string }).job_id, opportunityId: lead.opportunity_id };
}

/** yyyy-MM-dd, n days from today (UTC is close enough: tests use days well in the future or past). */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const schedule = async (client: Client, jobId: string, days: string[], assignees: string[], start = days[0]!, end = days[days.length - 1]!) => {
  const { data, error } = await client.rpc("schedule_job", { p_job_id: jobId, p_start: start, p_end: end, p_days: days, p_assignees: assignees });
  if (error) throw new Error(error.message);
  return data as Result;
};
const setStatus = (client: Client, jobId: string, status: "in_progress" | "completed" | "on_hold" | "cancelled" | "scheduled" | "pending_schedule") =>
  client.rpc("set_job_status", { p_job_id: jobId, p_status: status });
const job = async (id: string) => (await service.from("jobs").select("*").eq("id", id).single()).data!;
const workDays = async (jobId: string) =>
  (await service.from("appointments").select("assigned_to, status, starts_at, all_day, type, opportunity_id, property_id").eq("job_id", jobId).order("starts_at")).data!;
const openTaskKeys = async (opportunityId: string) =>
  (await service.from("tasks").select("auto_key").eq("opportunity_id", opportunityId).eq("status", "open")).data!.map((t) => t.auto_key).sort();

beforeAll(async () => {
  ({ client: admin } = await signInAs("admin@test.local"));
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field, userId: fieldId } = await signInAs("field@test.local"));
  ({ client: field2, userId: field2Id } = await signInAs("field2@test.local"));
});

afterAll(async () => {
  for (const id of customers) {
    const { data: jobs } = await service.from("jobs").select("id").eq("customer_id", id);
    for (const j of jobs ?? []) {
      await service.from("invoices").delete().eq("job_id", j.id);
      await service.from("jobs").delete().eq("id", j.id);
    }
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
});

describe("schedule_job", () => {
  it("sets dates, creates one all-day work appointment per day and person, assigns the crew, and closes the scheduling task", async () => {
    const { jobId, opportunityId } = await newJob();
    expect((await job(jobId)).status).toBe("pending_schedule");
    expect(await openTaskKeys(opportunityId)).toContain("schedule_job");

    expect(await schedule(sales, jobId, [day(10), day(11)], [fieldId, field2Id])).toEqual({ ok: true });

    expect(await job(jobId)).toMatchObject({ status: "scheduled", scheduled_start: day(10), scheduled_end: day(11) });
    const appts = await workDays(jobId);
    expect(appts).toHaveLength(4);
    for (const a of appts) {
      expect(a).toMatchObject({ type: "job_work", status: "scheduled", all_day: true, opportunity_id: opportunityId });
      expect(a.property_id).toBeTruthy(); // filled from the job by trigger
    }
    const { data: crew } = await service.from("job_assignments").select("user_id").eq("job_id", jobId);
    expect(crew!.map((c) => c.user_id).sort()).toEqual([fieldId, field2Id].sort());
    expect(await openTaskKeys(opportunityId)).not.toContain("schedule_job");
    const { data: acts } = await service.from("activities").select("summary").eq("job_id", jobId).eq("type", "job_status_changed");
    expect(acts).toHaveLength(1);
    expect(acts![0]!.summary).toMatch(/^Job J-\d+ scheduled for /);
  });

  it("calling it again replaces future work days and keeps the ones that still apply", async () => {
    const { jobId } = await newJob();
    await schedule(sales, jobId, [day(10), day(11)], [fieldId]);
    const before = await workDays(jobId);

    expect(await schedule(sales, jobId, [day(11), day(12)], [fieldId])).toEqual({ ok: true });
    const after = await workDays(jobId);
    const live = after.filter((a) => a.status === "scheduled");
    expect(live).toHaveLength(2);
    expect(after.filter((a) => a.status === "cancelled")).toHaveLength(1); // day 10 removed
    expect(live.map((a) => a.starts_at)).toContain(before[1]!.starts_at); // day 11 kept, not duplicated
    expect(await job(jobId)).toMatchObject({ scheduled_start: day(11), scheduled_end: day(12) });
  });

  it("validates its input and is denied to field users", async () => {
    const { jobId } = await newJob();
    expect(await schedule(sales, jobId, [day(5)], [fieldId], day(6), day(5))).toMatchObject({ ok: false, code: "invalid" });
    expect(await schedule(sales, jobId, [day(9)], [fieldId], day(5), day(6))).toMatchObject({ ok: false, code: "invalid" });
    expect(await schedule(sales, jobId, [], [fieldId], day(5), day(6))).toMatchObject({ ok: false, code: "invalid" });
    expect(await schedule(sales, jobId, [day(5)], [], day(5), day(6))).toMatchObject({ ok: false, code: "invalid" });
    expect(await workDays(jobId)).toHaveLength(0);
    expect((await job(jobId)).status).toBe("pending_schedule");

    const denied = await field.rpc("schedule_job", { p_job_id: jobId, p_start: day(5), p_end: day(5), p_days: [day(5)], p_assignees: [fieldId] });
    expect(denied.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("set_job_status", () => {
  it("an assigned field user can start and complete; completion sets the warranty date and creates the follow-up tasks", async () => {
    const { jobId, opportunityId } = await newJob();
    await schedule(sales, jobId, [day(1)], [fieldId]);
    await service.from("jobs").update({ warranty_years: 10 }).eq("id", jobId);

    // unassigned field user: cannot read or change the job
    expect((await field2.from("jobs").select("id").eq("id", jobId)).data).toEqual([]);
    expect((await setStatus(field2, jobId, "in_progress")).error?.code).toBe(PERMISSION_DENIED);

    // assigned field user: start and complete only, and never by direct update
    expect((await field.from("jobs").select("id").eq("id", jobId)).data).toHaveLength(1);
    expect((await setStatus(field, jobId, "cancelled")).error?.code).toBe(PERMISSION_DENIED);
    expect((await setStatus(field, jobId, "on_hold")).error?.code).toBe(PERMISSION_DENIED);
    expect((await field.from("jobs").update({ status: "completed" }).eq("id", jobId)).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.from("jobs").update({ status: "completed" }).eq("id", jobId)).error?.code).toBe(PERMISSION_DENIED);
    expect((await setStatus(field, jobId, "completed")).data).toMatchObject({ ok: false, code: "invalid_transition" });

    expect((await setStatus(field, jobId, "in_progress")).data).toEqual({ ok: true });
    expect((await job(jobId)).started_at).toBeTruthy();
    expect((await setStatus(field, jobId, "in_progress")).data).toEqual({ ok: true, already: true });

    expect((await setStatus(field, jobId, "completed")).data).toEqual({ ok: true });
    const done = await job(jobId);
    expect(done.status).toBe("completed");
    expect(done.completed_at).toBeTruthy();
    const { data: settings } = await service.from("company_settings").select("timezone").single();
    const completedDay = new Intl.DateTimeFormat("en-CA", { timeZone: settings!.timezone }).format(new Date(done.completed_at!));
    expect(done.warranty_expires_on).toBe(`${Number(completedDay.slice(0, 4)) + 10}${completedDay.slice(4)}`);

    const { data: tasks } = await service.from("tasks").select("auto_key, assigned_to, job_id, title").eq("opportunity_id", opportunityId).eq("status", "open").in("auto_key", ["final_invoice", "completion_photos"]);
    const byKey = Object.fromEntries(tasks!.map((t) => [t.auto_key, t]));
    const { data: firstAdmin } = await service.from("profiles").select("id").eq("role", "admin").eq("is_active", true).order("created_at").limit(1).single();
    expect(byKey.final_invoice).toMatchObject({ assigned_to: firstAdmin!.id, job_id: jobId, title: "Send final invoice" });
    expect(byKey.completion_photos).toMatchObject({ assigned_to: salesId, job_id: jobId });

    const { data: acts } = await service.from("activities").select("summary").eq("job_id", jobId).eq("type", "job_status_changed");
    expect(acts!.map((a) => a.summary.replace(/J-\d+/, "J-N"))).toEqual(expect.arrayContaining(["Job J-N started", "Job J-N completed"]));
    expect(acts!.every((a) => !a.summary.includes("$"))).toBe(true);

    // a completed job is final
    expect((await setStatus(admin, jobId, "cancelled")).data).toMatchObject({ ok: false, code: "invalid_transition" });
    expect(await schedule(sales, jobId, [day(3)], [fieldId])).toMatchObject({ ok: false, code: "invalid_status" });
  });

  it("cancelling cancels future work-day appointments and open job tasks", async () => {
    const { jobId, opportunityId } = await newJob();
    await schedule(sales, jobId, [day(2), day(3)], [fieldId]);
    // one work day already in the past
    await service.from("appointments").insert({ type: "job_work", title: "Earlier day", job_id: jobId, opportunity_id: opportunityId, assigned_to: fieldId, starts_at: `${day(-3)}T05:00:00Z`, ends_at: `${day(-2)}T05:00:00Z`, all_day: true } as never); // parent ids are filled by trigger
    expect((await openTaskKeys(opportunityId)).length).toBeGreaterThan(0);

    expect((await setStatus(sales, jobId, "cancelled")).data).toEqual({ ok: true });
    const appts = await workDays(jobId);
    expect(appts.filter((a) => a.status === "cancelled")).toHaveLength(2);
    expect(appts.filter((a) => a.status === "scheduled")).toHaveLength(1); // the past day is left as it was
    const { data: openJobTasks } = await service.from("tasks").select("id").eq("job_id", jobId).eq("status", "open");
    expect(openJobTasks).toEqual([]);
    expect((await job(jobId)).status).toBe("cancelled");
  });

  it("staff put a job on hold and resume it", async () => {
    const { jobId } = await newJob();
    expect((await setStatus(sales, jobId, "on_hold")).data).toEqual({ ok: true });
    expect((await setStatus(sales, jobId, "scheduled")).data).toMatchObject({ ok: false, code: "invalid_transition" }); // no dates yet
    expect((await setStatus(sales, jobId, "pending_schedule")).data).toEqual({ ok: true });
    await schedule(sales, jobId, [day(4)], [fieldId]);
    expect((await setStatus(sales, jobId, "on_hold")).data).toEqual({ ok: true });
    // an assigned field user cannot restart a job that staff put on hold
    expect((await setStatus(field, jobId, "in_progress")).error?.code).toBe(PERMISSION_DENIED);
    expect((await job(jobId)).status).toBe("on_hold");
    expect((await setStatus(sales, jobId, "scheduled")).data).toEqual({ ok: true });
  });
});
