import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFixtures, serviceClient, signInAs } from "./helpers";
import { attach } from "@/lib/supabase/inserts";
import type { Database } from "@/types/database";

type NoteInsert = Database["public"]["Tables"]["notes"]["Insert"];

let fx: Awaited<ReturnType<typeof loadFixtures>>;
const service = serviceClient();
const cleanup: (() => PromiseLike<unknown>)[] = [];

beforeAll(async () => {
  fx = await loadFixtures();
});
afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

describe("fill_parent_ids", () => {
  it("fills opportunity and customer from a job", async () => {
    const admin = await signInAs("admin@test.local");
    const { data, error } = await service
      .from("tasks")
      .insert({ title: "Trigger test", job_id: fx.jobId, assigned_to: admin.userId, due_at: new Date().toISOString() })
      .select("id, opportunity_id, customer_id")
      .single();
    expect(error).toBeNull();
    cleanup.push(() => service.from("tasks").delete().eq("id", data!.id));
    expect(data).toMatchObject({ opportunity_id: fx.wonDeal.id, customer_id: fx.wonDeal.customer_id });
  });

  it("fills customer and property on an appointment from its deal", async () => {
    const admin = await signInAs("admin@test.local");
    const { data, error } = await service
      .from("appointments")
      .insert({ type: "other", title: "Trigger test", opportunity_id: fx.unassignedDeal.id, customer_id: fx.unassignedDeal.customer_id, assigned_to: admin.userId, starts_at: "2030-01-01T15:00:00Z", ends_at: "2030-01-01T16:00:00Z" })
      .select("id, customer_id, property_id, google_sync_status")
      .single();
    expect(error).toBeNull();
    cleanup.push(() => service.from("appointments").delete().eq("id", data!.id));
    expect(data).toMatchObject({ customer_id: fx.unassignedDeal.customer_id, property_id: fx.unassignedDeal.property_id });
    // No Google connection yet, so nothing is queued.
    expect(data!.google_sync_status).toBe("not_synced");
  });

  it("rejects a note with no parent at all", async () => {
    const { error } = await service.from("notes").insert({ body: "orphan" } as never);
    expect(error?.code).toBe("23502");
  });
});

describe("stage tracking", () => {
  it("writes history and resets stage_entered_at when the stage changes", async () => {
    const id = fx.unassignedDeal.id;
    const { data: before } = await service.from("opportunities").select("stage, stage_entered_at").eq("id", id).single();
    const { count: historyBefore } = await service.from("opportunity_stage_history").select("id", { count: "exact", head: true }).eq("opportunity_id", id);

    await service.from("opportunities").update({ stage: "contacted" }).eq("id", id);
    cleanup.push(() => service.from("opportunities").update({ stage: before!.stage }).eq("id", id));

    const { data: after } = await service.from("opportunities").select("stage_entered_at").eq("id", id).single();
    expect(new Date(after!.stage_entered_at).getTime()).toBeGreaterThan(new Date(before!.stage_entered_at).getTime());

    const { data: history } = await service
      .from("opportunity_stage_history")
      .select("from_stage, to_stage")
      .eq("opportunity_id", id)
      .order("changed_at", { ascending: false })
      .limit(1);
    expect(history).toEqual([{ from_stage: "qualified", to_stage: "contacted" }]);
    const { count: historyAfter } = await service.from("opportunity_stage_history").select("id", { count: "exact", head: true }).eq("opportunity_id", id);
    expect(historyAfter).toBe(historyBefore! + 1);

    // A non-stage edit does not add history.
    await service.from("opportunities").update({ description: "no stage change" }).eq("id", id);
    const { count: unchanged } = await service.from("opportunity_stage_history").select("id", { count: "exact", head: true }).eq("opportunity_id", id);
    expect(unchanged).toBe(historyAfter);
    await service.from("opportunities").update({ description: null }).eq("id", id);
  });
});

describe("estimate totals and lock", () => {
  it("computes totals per spec §7.2 with mixed taxable lines and a discount", async () => {
    const { data: estimate } = await service
      .from("estimates")
      .insert({ opportunity_id: fx.unassignedDeal.id, title: "Totals test", tax_rate: 0.0825, discount_cents: 10000, deposit_percent: 30 })
      .select("id")
      .single();
    cleanup.push(() => service.from("estimates").delete().eq("id", estimate!.id));

    await service.from("estimate_line_items").insert([
      { estimate_id: estimate!.id, name: "Taxable", quantity: 10, unit_price_cents: 10000, is_taxable: true },
      { estimate_id: estimate!.id, name: "Labor", quantity: 2.5, unit_price_cents: 20000, is_taxable: false },
    ]);
    const read = () => service.from("estimates").select("subtotal_cents, tax_cents, total_cents, deposit_cents").eq("id", estimate!.id).single();

    // subtotal 150000; taxable 100000; discount share of taxable = round(10000*100000/150000) = 6667
    // tax = round(93333 * 0.0825) = 7700; total = 150000 - 10000 + 7700; deposit = 30%
    expect((await read()).data).toEqual({ subtotal_cents: 150000, tax_cents: 7700, total_cents: 147700, deposit_cents: 44310 });

    // Changing a header input recalculates.
    await service.from("estimates").update({ discount_cents: 0 }).eq("id", estimate!.id);
    expect((await read()).data).toEqual({ subtotal_cents: 150000, tax_cents: 8250, total_cents: 158250, deposit_cents: 47475 });

    // Removing a line recalculates.
    await service.from("estimate_line_items").delete().eq("estimate_id", estimate!.id).eq("name", "Labor");
    expect((await read()).data).toEqual({ subtotal_cents: 100000, tax_cents: 8250, total_cents: 108250, deposit_cents: 32475 });
  });

  it("freezes a sent estimate: no line edits, inserts, deletes, or content changes; status still moves", async () => {
    const { data: estimate } = await service.from("estimates").select("id, total_cents").eq("opportunity_id", fx.estimateDeal.id).single();
    const { data: lines } = await service.from("estimate_line_items").select("id").eq("estimate_id", estimate!.id);

    const edit = await service.from("estimate_line_items").update({ unit_price_cents: 1 }).eq("id", lines![0]!.id);
    expect(edit.error?.hint).toBe("estimate_locked");
    const insert = await service.from("estimate_line_items").insert({ estimate_id: estimate!.id, name: "Late add", unit_price_cents: 100 });
    expect(insert.error?.hint).toBe("estimate_locked");
    const remove = await service.from("estimate_line_items").delete().eq("id", lines![0]!.id);
    expect(remove.error?.hint).toBe("estimate_locked");
    const header = await service.from("estimates").update({ discount_cents: 5 }).eq("id", estimate!.id);
    expect(header.error?.hint).toBe("estimate_locked");

    const status = await service.from("estimates").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", estimate!.id);
    expect(status.error).toBeNull();
    await service.from("estimates").update({ status: "sent", viewed_at: null }).eq("id", estimate!.id);

    const { data: after } = await service.from("estimates").select("total_cents").eq("id", estimate!.id).single();
    expect(after!.total_cents).toBe(estimate!.total_cents);
  });
});

describe("notes", () => {
  it("adds one timeline entry per note", async () => {
    const sales = await signInAs("sales@test.local");
    const { data: note, error } = await sales.client
      .from("notes")
      .insert(attach<NoteInsert>({ opportunity_id: fx.unassignedDeal.id, body: "Timeline test" }))
      .select("id, customer_id")
      .single();
    expect(error).toBeNull();
    cleanup.push(() => service.from("notes").delete().eq("id", note!.id));
    expect(note!.customer_id).toBe(fx.unassignedDeal.customer_id);

    const { data: activities } = await service.from("activities").select("id, type, summary, actor_id").contains("metadata", { note_id: note!.id });
    expect(activities).toHaveLength(1);
    expect(activities![0]).toMatchObject({ type: "note_added", summary: "Sam Sales added a note", actor_id: sales.userId });
    cleanup.push(() => service.from("activities").delete().eq("id", activities![0]!.id));
  });
});
