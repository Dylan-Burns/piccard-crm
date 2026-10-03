import { beforeAll, describe, expect, it } from "vitest";
import { ALL_TABLES, anonClient, loadFixtures, PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";
import { attach } from "@/lib/supabase/inserts";
import type { Database } from "@/types/database";

type NoteInsert = Database["public"]["Tables"]["notes"]["Insert"];

type Fixtures = Awaited<ReturnType<typeof loadFixtures>>;
let fx: Fixtures;
let admin: Client, sales: Client, field: Client, field2: Client;
let salesId: string, fieldId: string;
const service = serviceClient();

beforeAll(async () => {
  fx = await loadFixtures();
  ({ client: admin } = await signInAs("admin@test.local"));
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field, userId: fieldId } = await signInAs("field@test.local"));
  ({ client: field2 } = await signInAs("field2@test.local"));
});

describe("sales", () => {
  it("reads customers, deals, and estimates", async () => {
    for (const table of ["customers", "opportunities", "estimates", "invoices", "activities"] as const) {
      const { error } = await sales.from(table).select("id").limit(1);
      expect(error, table).toBeNull();
    }
    const { data } = await sales.from("opportunities").select("id");
    expect(data!.length).toBeGreaterThanOrEqual(20); // seed has 20; e2e runs add more
  });

  it("creates and edits a customer and property, but cannot delete them", async () => {
    const { data: customer, error } = await sales
      .from("customers")
      .insert({ first_name: "Temp", last_name: "Customer", phone: "5550000" })
      .select("id, created_by")
      .single();
    expect(error).toBeNull();
    expect(customer!.created_by).toBe(salesId); // default auth.uid()

    const { error: propError } = await sales.from("properties").insert({ customer_id: customer!.id, address_line1: "1 Test St" });
    expect(propError).toBeNull();
    const { error: updateError } = await sales.from("customers").update({ last_name: "Edited" }).eq("id", customer!.id);
    expect(updateError).toBeNull();

    await sales.from("customers").delete().eq("id", customer!.id);
    const { data: still } = await service.from("customers").select("last_name").eq("id", customer!.id).single();
    expect(still!.last_name).toBe("Edited");
    await service.from("customers").delete().eq("id", customer!.id);
  });

  it("edits a deal's descriptive fields", async () => {
    const { error } = await sales.from("opportunities").update({ description: "Edited by sales" }).eq("id", fx.unassignedDeal.id);
    expect(error).toBeNull();
    await service.from("opportunities").update({ description: null }).eq("id", fx.unassignedDeal.id);
  });

  it("cannot delete a deal", async () => {
    await sales.from("opportunities").delete().eq("id", fx.unassignedDeal.id);
    const { data } = await service.from("opportunities").select("id").eq("id", fx.unassignedDeal.id);
    expect(data).toHaveLength(1);
  });

  it("cannot create deals, jobs, or invoices directly", async () => {
    const opp = await sales.from("opportunities").insert({ customer_id: fx.wonDeal.customer_id, title: "Direct" });
    expect(opp.error?.code).toBe(PERMISSION_DENIED);
    const invoice = await sales.from("invoices").insert({ job_id: fx.jobId, customer_id: fx.wonDeal.customer_id, kind: "final" });
    expect(invoice.error?.code).toBe(PERMISSION_DENIED);
  });

  it("cannot edit the price book or lead sources (admin only)", async () => {
    const { error } = await sales.from("lead_sources").insert({ name: "Sneaky" });
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { data } = await service.from("lead_sources").select("id").eq("name", "Sneaky");
    expect(data).toHaveLength(0);
  });
});

describe("field", () => {
  it("sees no deals, estimates, invoices, or timeline entries", async () => {
    for (const table of ["opportunities", "estimates", "estimate_line_items", "invoices", "activities", "lead_sources", "price_book_items"] as const) {
      const { data, error } = await field.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  it("sees exactly the customers, properties, jobs, and appointments tied to their assignments", async () => {
    // Expected rows are derived with the service client, because e2e runs leave appointments
    // assigned to this user. The seed fixtures must always be among them.
    const { data: live } = await service.from("appointments").select("id, customer_id, opportunity_id").eq("assigned_to", fieldId).in("status", ["scheduled", "completed"]);
    const { data: assigned } = await service.from("job_assignments").select("job:jobs!inner(id, customer_id)").eq("user_id", fieldId);
    const customerIds = [...new Set([...live!.map((a) => a.customer_id), ...assigned!.map((a) => a.job.customer_id)])].sort();
    expect(customerIds).toEqual(expect.arrayContaining([fx.inspectionDeal.customer_id, fx.wonDeal.customer_id]));

    const { data: customers } = await field.from("customers").select("id");
    expect(customers!.map((c) => c.id).sort()).toEqual(customerIds);

    const { data: properties } = await field.from("properties").select("id");
    const { data: expectedProperties } = await service.from("properties").select("id").in("customer_id", customerIds);
    expect(properties!.map((p) => p.id).sort()).toEqual(expectedProperties!.map((p) => p.id).sort());
    expect(properties!.length).toBeGreaterThanOrEqual(3); // John Smith has two properties

    const { data: jobs } = await field.from("jobs").select("id");
    expect(jobs).toEqual([{ id: fx.jobId }]);

    const { data: appointments } = await field.from("appointments").select("id, opportunity_id, assigned_to");
    expect(appointments!.map((a) => a.id).sort()).toEqual(live!.map((a) => a.id).sort());
    expect(appointments!.every((a) => a.assigned_to === fieldId)).toBe(true);
    expect(appointments!.map((a) => a.opportunity_id)).toContain(fx.inspectionDeal.id);
  });

  it("another field user with no assignments sees nothing", async () => {
    for (const table of ["customers", "properties", "jobs", "appointments", "notes", "files", "tasks"] as const) {
      const { data } = await field2.from(table).select("id");
      expect(data, table).toEqual([]);
    }
  });

  it("adds a note on an assigned job (ancestors filled by trigger) but not on an unrelated deal", async () => {
    const { data: note, error } = await field
      .from("notes")
      .insert(attach<NoteInsert>({ job_id: fx.jobId, body: "Decking soft near chimney" }))
      .select("id, opportunity_id, customer_id, author_id")
      .single();
    expect(error).toBeNull();
    expect(note).toMatchObject({ opportunity_id: fx.wonDeal.id, customer_id: fx.wonDeal.customer_id, author_id: fieldId });
    await service.from("notes").delete().eq("id", note!.id);

    const denied = await field.from("notes").insert(attach<NoteInsert>({ opportunity_id: fx.unassignedDeal.id, body: "should fail" }));
    expect(denied.error?.code).toBe(PERMISSION_DENIED);
  });

  it("sees photos but not estimate files on an assigned deal", async () => {
    const { data } = await field.from("files").select("category").eq("opportunity_id", fx.wonDeal.id);
    expect(data).toEqual([{ category: "photo" }]);
  });

  it("sees only their own tasks and cannot change a due date", async () => {
    const { data: tasks } = await field.from("tasks").select("id, due_at, assigned_to");
    expect(tasks).toHaveLength(1);
    expect(tasks![0]!.assigned_to).toBe(fieldId);

    await field.from("tasks").update({ due_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }).eq("id", tasks![0]!.id);
    const { data: after } = await service.from("tasks").select("due_at").eq("id", tasks![0]!.id).single();
    expect(after!.due_at).toBe(tasks![0]!.due_at);
  });

  it("cannot reschedule an appointment or change a job", async () => {
    const appt = await field.from("appointments").update({ starts_at: new Date().toISOString() }).eq("opportunity_id", fx.inspectionDeal.id);
    expect(appt.error?.code).toBe(PERMISSION_DENIED);
    await field.from("jobs").update({ title: "Hacked" }).eq("id", fx.jobId);
    const { data } = await service.from("jobs").select("title").eq("id", fx.jobId).single();
    expect(data!.title).not.toBe("Hacked");
  });
});

describe("admin", () => {
  it("can delete a deal", async () => {
    const { data: temp } = await service
      .from("opportunities")
      .insert({ customer_id: fx.unassignedDeal.customer_id, title: "Temp deal for delete" })
      .select("id")
      .single();
    const { error } = await admin.from("opportunities").delete().eq("id", temp!.id);
    expect(error).toBeNull();
    const { data } = await service.from("opportunities").select("id").eq("id", temp!.id);
    expect(data).toHaveLength(0);
  });

  it("manages lead sources", async () => {
    const { data, error } = await admin.from("lead_sources").insert({ name: "Home Show", sort_order: 80 }).select("id").single();
    expect(error).toBeNull();
    await admin.from("lead_sources").delete().eq("id", data!.id);
  });
});

describe("anon", () => {
  it("is denied on every table", async () => {
    const anon = anonClient();
    for (const table of ALL_TABLES) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      expect(error?.code, table).toBe(PERMISSION_DENIED);
      expect(data, table).toBeNull();
    }
  });
});

describe("service-only tables", () => {
  it("are not readable by signed-in users", async () => {
    for (const table of ["integration_connections", "sync_outbox", "email_log"] as const) {
      const { error } = await admin.from(table).select("*").limit(1);
      expect(error?.code, table).toBe(PERMISSION_DENIED);
    }
  });
});

describe("policy hardening (0004)", () => {
  it("field access through an appointment ends when it is cancelled", async () => {
    const { data: before } = await field.from("customers").select("id").eq("id", fx.inspectionDeal.customer_id);
    expect(before).toHaveLength(1);

    await service.from("appointments").update({ status: "cancelled" }).eq("opportunity_id", fx.inspectionDeal.id);
    try {
      const { data: customers } = await field.from("customers").select("id").eq("id", fx.inspectionDeal.customer_id);
      expect(customers).toEqual([]);
      const { data: notes } = await field.from("notes").select("id").eq("opportunity_id", fx.inspectionDeal.id);
      expect(notes).toEqual([]);
    } finally {
      await service.from("appointments").update({ status: "scheduled" }).eq("opportunity_id", fx.inspectionDeal.id);
    }
  });

  it("a deactivated user cannot edit their own profile", async () => {
    await service.from("profiles").update({ is_active: false }).eq("id", fieldId);
    try {
      await field.from("profiles").update({ full_name: "Still Here" }).eq("id", fieldId);
      const { data } = await service.from("profiles").select("full_name").eq("id", fieldId).single();
      expect(data!.full_name).toBe("Fran Field");
    } finally {
      await service.from("profiles").update({ is_active: true }).eq("id", fieldId);
    }
  });
});
