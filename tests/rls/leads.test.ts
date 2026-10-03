import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attach } from "@/lib/supabase/inserts";
import type { Database, Json } from "@/types/database";
import { anonClient, loadFixtures, PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";

type NoteInsert = Database["public"]["Tables"]["notes"]["Insert"];
type LeadResult = {
  ok: boolean; status?: string; code?: string; customer_id?: string; opportunity_id?: string;
  is_new_customer?: boolean; possible_duplicate_of?: string | null; owner_id?: string | null;
};

let fx: Awaited<ReturnType<typeof loadFixtures>>;
let sales: Client, field: Client;
let salesId: string, adminId: string, fieldId: string;
const service = serviceClient();
const createdCustomers: string[] = [];
let seq = 0;

/** A lead with a unique phone, so tests do not collide. */
function lead(overrides: Record<string, unknown> = {}) {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  return {
    channel: "website", first_name: "Test", last_name: `Lead${n}`, phone: `555${n}`, phone_e164: `+1415${n}`,
    address_line1: `${seq} Test Road`, postal_code: "62701", work_type: "roof_repair", source_name: "Website",
    ...overrides,
  };
}
async function createLead(client: Client, input: Record<string, unknown>): Promise<LeadResult> {
  const { data, error } = await client.rpc("create_lead", { p: input as Json });
  if (error) throw new Error(error.message);
  const result = data as LeadResult;
  if (result.is_new_customer && result.customer_id) createdCustomers.push(result.customer_id);
  return result;
}
const openTasks = async (opportunityId: string) =>
  (await service.from("tasks").select("auto_key, assigned_to, due_at").eq("opportunity_id", opportunityId).eq("status", "open")).data!;
const activityTypes = async (opportunityId: string) =>
  (await service.from("activities").select("type").eq("opportunity_id", opportunityId).order("created_at")).data!.map((a) => a.type);

beforeAll(async () => {
  fx = await loadFixtures();
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ userId: adminId } = await signInAs("admin@test.local"));
  ({ client: field, userId: fieldId } = await signInAs("field@test.local"));
});

afterAll(async () => {
  for (const id of createdCustomers) {
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
});

describe("create_lead", () => {
  it("creates customer, property, deal, first-contact task, and timeline entry", async () => {
    const result = await createLead(service, lead({ message: "Leak in the attic" }));
    expect(result).toMatchObject({ ok: true, status: "created", is_new_customer: true, possible_duplicate_of: null });

    const { data: deal } = await service.from("opportunities")
      .select("stage, title, work_type, description, property_id, owner_id, source_id").eq("id", result.opportunity_id!).single();
    expect(deal).toMatchObject({ stage: "new", work_type: "roof_repair", description: "Leak in the attic", owner_id: null });
    expect(deal!.title).toMatch(/^Roof Repair — \d+ Test Road$/);
    expect(deal!.property_id).toBeTruthy();
    expect(deal!.source_id).toBeTruthy();

    const tasks = await openTasks(result.opportunity_id!);
    expect(tasks.map((t) => t.auto_key)).toEqual(["first_contact"]);
    expect(tasks[0]!.assigned_to).toBe(adminId); // no owner → first active admin
    expect(await activityTypes(result.opportunity_id!)).toEqual(["lead_received"]);
  });

  it("merges a repeat inquiry for the same customer and address", async () => {
    const input = lead();
    const first = await createLead(service, input);
    const second = await createLead(service, { ...input, message: "Any update?" });
    expect(second).toMatchObject({ status: "merged_duplicate", opportunity_id: first.opportunity_id, is_new_customer: false });

    const { data: deals } = await service.from("opportunities").select("id").eq("customer_id", first.customer_id!);
    expect(deals).toHaveLength(1);
    expect(await activityTypes(first.opportunity_id!)).toEqual(["lead_received", "duplicate_inquiry", "note_added"]);
    expect((await openTasks(first.opportunity_id!)).map((t) => t.auto_key).sort()).toEqual(["duplicate_inquiry", "first_contact"]);
    const { data: notes } = await service.from("notes").select("body, author_id, shared_with_crew").eq("opportunity_id", first.opportunity_id!);
    expect(notes).toEqual([{ body: "Any update?", author_id: null, shared_with_crew: false }]);
  });

  it("creates a second deal, flagged as a possible duplicate, for a different address", async () => {
    const input = lead();
    const first = await createLead(service, input);
    const second = await createLead(service, { ...input, address_line1: "999 Other Building Ave" });
    expect(second).toMatchObject({ status: "created", is_new_customer: false, possible_duplicate_of: first.opportunity_id });
    expect(second.opportunity_id).not.toBe(first.opportunity_id);
    const { data: props } = await service.from("properties").select("id").eq("customer_id", first.customer_id!);
    expect(props).toHaveLength(2);
    expect(await activityTypes(second.opportunity_id!)).toContain("system");
  });

  it("with no address and two open deals, creates a new flagged deal instead of guessing", async () => {
    const input = lead();
    await createLead(service, input);
    await createLead(service, { ...input, address_line1: "500 Second Site Blvd" });
    const third = await createLead(service, { ...input, address_line1: null, postal_code: null });
    expect(third.status).toBe("created");
    expect(third.possible_duplicate_of).toBeTruthy();
  });

  it("with no address and one open deal, merges", async () => {
    const input = lead();
    const first = await createLead(service, input);
    const second = await createLead(service, { ...input, address_line1: null, postal_code: null });
    expect(second).toMatchObject({ status: "merged_duplicate", opportunity_id: first.opportunity_id });
  });

  it("creates a new deal on the same customer once the earlier one is closed", async () => {
    const input = lead();
    const first = await createLead(service, input);
    await service.from("opportunities")
      .update({ stage: "lost", lost_at: new Date().toISOString(), lost_reason: "price" }).eq("id", first.opportunity_id!);
    const second = await createLead(service, input);
    expect(second).toMatchObject({ status: "created", is_new_customer: false, customer_id: first.customer_id, possible_duplicate_of: null });
    const { data: props } = await service.from("properties").select("id").eq("customer_id", first.customer_id!);
    expect(props).toHaveLength(1); // property reused
  });

  it("never merges manual entry; the person chose", async () => {
    const input = lead();
    const first = await createLead(service, input);
    const second = await createLead(sales, { ...input, channel: "manual", owner_id: salesId });
    expect(second).toMatchObject({ status: "created", possible_duplicate_of: first.opportunity_id, owner_id: salesId });
    const { data: deal } = await service.from("opportunities").select("created_by, owner_id").eq("id", second.opportunity_id!).single();
    expect(deal).toEqual({ created_by: salesId, owner_id: salesId });
    expect((await openTasks(second.opportunity_id!))[0]!.assigned_to).toBe(salesId);
  });

  it("validates input and returns a result instead of raising", async () => {
    expect(await createLead(service, { channel: "website", first_name: "NoContact" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createLead(service, { channel: "website", phone: "5551234" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("imports at a given stage with one review task, and skips an existing open deal", async () => {
    const input = lead({ channel: "import", import_stage: "estimate_sent", owner_id: salesId });
    const first = await createLead(service, input);
    expect(first.status).toBe("created");
    const { data: deal } = await service.from("opportunities").select("stage").eq("id", first.opportunity_id!).single();
    expect(deal!.stage).toBe("estimate_sent");
    expect((await openTasks(first.opportunity_id!)).map((t) => t.auto_key)).toEqual(["imported_review"]);
    expect((await createLead(service, input)).status).toBe("skipped");
  });

  it("is denied to field users and anonymous callers; import is service-only", async () => {
    expect((await field.rpc("create_lead", { p: lead() })).error?.code).toBe(PERMISSION_DENIED);
    expect((await anonClient().rpc("create_lead", { p: lead() })).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.rpc("create_lead", { p: lead({ channel: "import" }) })).error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("log_contact", () => {
  it("no answer: records the first attempt, schedules a retry, stays in New", async () => {
    const { opportunity_id: id } = await createLead(service, lead());
    const { data } = await sales.rpc("log_contact", { p_opportunity_id: id!, p_type: "call", p_outcome: "no_answer" });
    expect(data).toMatchObject({ ok: true, advanced: false });

    const { data: deal } = await service.from("opportunities")
      .select("stage, first_contact_attempted_at, first_contact_attempted_by, first_contacted_at").eq("id", id!).single();
    expect(deal!.stage).toBe("new");
    expect(deal!.first_contact_attempted_by).toBe(salesId);
    expect(deal!.first_contact_attempted_at).toBeTruthy();
    expect(deal!.first_contacted_at).toBeNull();
    expect((await openTasks(id!)).map((t) => t.auto_key)).toEqual(["retry_contact"]);
  });

  it("connected: takes ownership of an unowned lead, moves to Contacted, swaps the tasks", async () => {
    const { opportunity_id: id } = await createLead(service, lead());
    await sales.rpc("log_contact", { p_opportunity_id: id!, p_type: "call", p_outcome: "no_answer" });
    const firstAttempt = (await service.from("opportunities").select("first_contact_attempted_at").eq("id", id!).single()).data!.first_contact_attempted_at;

    const { data } = await sales.rpc("log_contact", { p_opportunity_id: id!, p_type: "call", p_outcome: "connected", p_summary: "Wants a quote this week" });
    expect(data).toMatchObject({ ok: true, advanced: true });

    const { data: deal } = await service.from("opportunities")
      .select("stage, owner_id, first_contacted_at, first_contact_attempted_at").eq("id", id!).single();
    expect(deal!.stage).toBe("contacted");
    expect(deal!.owner_id).toBe(salesId);
    expect(deal!.first_contacted_at).toBeTruthy();
    expect(deal!.first_contact_attempted_at).toBe(firstAttempt); // first attempt is not overwritten

    const tasks = await openTasks(id!);
    expect(tasks.map((t) => t.auto_key)).toEqual(["qualify"]);
    expect(tasks[0]!.assigned_to).toBe(salesId);
    expect(await activityTypes(id!)).toEqual(["lead_received", "call", "call", "stage_changed"]);

    const { data: call } = await service.from("activities").select("summary, metadata").eq("opportunity_id", id!).eq("type", "call").order("created_at", { ascending: false }).limit(1).single();
    expect(call!.summary).toBe("Sam Sales called — connected");
    expect(call!.metadata).toMatchObject({ outcome: "connected", notes: "Wants a quote this week" });
  });

  it("is denied to field users", async () => {
    const { error } = await field.rpc("log_contact", { p_opportunity_id: fx.inspectionDeal.id, p_type: "call", p_outcome: "connected" });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("assign_owner", () => {
  it("changes the owner, moves open automatic tasks, and logs it", async () => {
    const { opportunity_id: id } = await createLead(service, lead());
    const { data } = await sales.rpc("assign_owner", { p_opportunity_id: id!, p_owner_id: salesId });
    expect(data).toMatchObject({ ok: true, changed: true });
    expect((await openTasks(id!))[0]!.assigned_to).toBe(salesId);
    expect(await activityTypes(id!)).toContain("owner_changed");
  });

  it("rejects a field user as owner", async () => {
    const { data } = await sales.rpc("assign_owner", { p_opportunity_id: fx.unassignedDeal.id, p_owner_id: fieldId });
    expect(data).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("set_task_status", () => {
  it("lets a field user complete their own task but not cancel it or touch others", async () => {
    const { data: mine } = await service.from("tasks")
      .insert({ title: "Field task", job_id: fx.jobId, assigned_to: fieldId, due_at: new Date().toISOString() }).select("id").single();
    const { data: theirs } = await service.from("tasks")
      .insert({ title: "Sales task", opportunity_id: fx.unassignedDeal.id, assigned_to: salesId, due_at: new Date().toISOString() }).select("id").single();
    try {
      expect((await field.rpc("set_task_status", { p_task_id: mine!.id, p_status: "cancelled" })).error?.code).toBe(PERMISSION_DENIED);
      expect((await field.rpc("set_task_status", { p_task_id: theirs!.id, p_status: "done" })).error?.code).toBe(PERMISSION_DENIED);

      const { data } = await field.rpc("set_task_status", { p_task_id: mine!.id, p_status: "done" });
      expect(data).toMatchObject({ ok: true, changed: true });
      const { data: task } = await service.from("tasks").select("status, completed_by, completed_at").eq("id", mine!.id).single();
      expect(task).toMatchObject({ status: "done", completed_by: fieldId });
      expect(task!.completed_at).toBeTruthy();

      // staff can reopen
      await sales.rpc("set_task_status", { p_task_id: mine!.id, p_status: "open" });
      const { data: reopened } = await service.from("tasks").select("status, completed_at").eq("id", mine!.id).single();
      expect(reopened).toEqual({ status: "open", completed_at: null });
    } finally {
      await service.from("activities").delete().contains("metadata", { task_id: mine!.id });
      await service.from("tasks").delete().in("id", [mine!.id, theirs!.id]);
    }
  });
});

describe("notes shared with crew", () => {
  it("hides staff notes from field unless shared; field notes are always shared", async () => {
    const { data: visible } = await field.from("notes").select("body").eq("opportunity_id", fx.wonDeal.id);
    expect(visible!.map((n) => n.body)).toEqual(["Customer prefers morning arrivals. Dog in back yard."]);

    const { data: hidden } = await sales.from("notes")
      .insert(attach<NoteInsert>({ opportunity_id: fx.wonDeal.id, body: "Quoted $24,800, do not discount" })).select("id").single();
    const { data: shared } = await sales.from("notes")
      .insert(attach<NoteInsert>({ opportunity_id: fx.wonDeal.id, body: "Park on the street", shared_with_crew: true })).select("id").single();
    const { data: own } = await field.from("notes")
      .insert(attach<NoteInsert>({ job_id: fx.jobId, body: "Found rot at the eave" })).select("id, shared_with_crew").single();
    try {
      expect(own!.shared_with_crew).toBe(true);
      const { data: after } = await field.from("notes").select("body").eq("opportunity_id", fx.wonDeal.id);
      expect(after!.map((n) => n.body).sort()).toEqual(
        ["Customer prefers morning arrivals. Dog in back yard.", "Found rot at the eave", "Park on the street"].sort(),
      );
    } finally {
      const ids = [hidden!.id, shared!.id, own!.id];
      for (const id of ids) await service.from("activities").delete().contains("metadata", { note_id: id });
      await service.from("notes").delete().in("id", ids);
    }
  });
});
