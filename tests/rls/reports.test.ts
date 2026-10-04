import { createClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/types/database";
import { SEED_PASSWORD, serviceClient, signInAs, type Client } from "./helpers";

/**
 * Reporting functions (spec §8) against a fixed dataset. The deals belong to a rep created for this
 * test and are dated in March 2019, so the seed data and other tests cannot change the numbers.
 *
 *   A  created Mar 5,  won Mar 31 at 23:30 company time (already April in UTC)   $10,000
 *   B  created Mar 10, won Mar 20, then reassigned to another rep                $5,000
 *   C  created Mar 12, lost Mar 25 (price), estimated $3,000
 *   D  created Mar 15, lost Mar 26 as a duplicate  → excluded everywhere
 *   E  created Mar 20, still open, estimated $7,000
 *   F  created Feb 10, won Apr 2                    → outside March
 */
const service = serviceClient();
const FROM = "2019-03-01";
const TO = "2019-03-31";
let rep: Client, sales: Client, field: Client;
let repId: string, salesId: string, sourceId: string, timeZone: string;
const repEmail = `reports-rep-${Date.now()}@test.local`;
const sourceName = `Report Source ${Date.now()}`;
const customers: string[] = [];
const deals: Record<string, string> = {};

async function lead(key: string, createdAt: string) {
  const n = String(Date.now()).slice(-6) + key;
  const { data } = await service.rpc("create_lead", {
    p: { channel: "manual", first_name: "Report", last_name: `Deal${key}${n}`, phone: `562${n}`, phone_e164: `+1217555${String(customers.length).padStart(4, "0")}`, address_line1: `${key} Metric Way`, postal_code: "62701", work_type: "roof_replacement", owner_id: repId, source_id: sourceId } as Json,
  });
  const r = data as { opportunity_id: string; customer_id: string };
  customers.push(r.customer_id);
  deals[key] = r.opportunity_id;
  await service.from("opportunities").update({ created_at: createdAt }).eq("id", r.opportunity_id);
  return r.opportunity_id;
}
const win = async (key: string, cents: number, wonAt: string) => {
  const { error } = await rep.rpc("mark_opportunity_won", { p_opportunity_id: deals[key]!, p_amount_cents: cents });
  if (error) throw new Error(error.message);
  await service.from("opportunities").update({ won_at: wonAt }).eq("id", deals[key]!);
};
const lose = async (key: string, reason: "price" | "duplicate", lostAt: string, estimated: number) => {
  await service.from("opportunities").update({ estimated_value_cents: estimated }).eq("id", deals[key]!);
  const { error } = await rep.rpc("mark_opportunity_lost", { p_opportunity_id: deals[key]!, p_reason: reason });
  if (error) throw new Error(error.message);
  await service.from("opportunities").update({ lost_at: lostAt }).eq("id", deals[key]!);
};

beforeAll(async () => {
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field } = await signInAs("field@test.local"));
  timeZone = (await service.from("company_settings").select("timezone").single()).data!.timezone;

  const { data: created, error } = await service.auth.admin.createUser({ email: repEmail, password: SEED_PASSWORD, email_confirm: true, user_metadata: { full_name: "Rep Orter" } });
  if (error) throw error;
  repId = created.user.id;
  await service.from("profiles").update({ role: "sales", full_name: "Rep Orter", is_active: true }).eq("id", repId);
  rep = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  await rep.auth.signInWithPassword({ email: repEmail, password: SEED_PASSWORD });
  sourceId = (await service.from("lead_sources").insert({ name: sourceName, sort_order: 9999 }).select("id").single()).data!.id;

  await lead("A", "2019-03-05T15:00:00Z");
  await lead("B", "2019-03-10T15:00:00Z");
  await lead("C", "2019-03-12T15:00:00Z");
  await lead("D", "2019-03-15T15:00:00Z");
  await lead("E", "2019-03-20T15:00:00Z");
  await lead("F", "2019-02-10T15:00:00Z");

  // Speed to lead: A's first attempt (a no-answer call) came 12 minutes in, the connection 3 hours in.
  await rep.rpc("log_contact", { p_opportunity_id: deals.A!, p_type: "call", p_outcome: "no_answer" });
  await rep.rpc("log_contact", { p_opportunity_id: deals.A!, p_type: "call", p_outcome: "connected" });
  await service.from("opportunities").update({ first_contact_attempted_at: "2019-03-05T15:12:00Z", first_contacted_at: "2019-03-05T18:00:00Z" }).eq("id", deals.A!);
  await rep.rpc("log_contact", { p_opportunity_id: deals.C!, p_type: "call", p_outcome: "left_voicemail" });
  await service.from("opportunities").update({ first_contact_attempted_at: "2019-03-12T15:30:00Z" }).eq("id", deals.C!);

  // 23:30 on March 31 in the company timezone is already April 1 in UTC.
  const lastNight = fromZonedTime("2019-03-31T23:30:00", timeZone).toISOString();
  expect(lastNight.slice(0, 10)).toBe("2019-04-01");
  await win("A", 1_000_000, lastNight);
  await win("B", 500_000, "2019-03-20T15:00:00Z");
  await service.from("opportunities").update({ owner_id: salesId }).eq("id", deals.B!); // reassigned after it was won
  await lose("C", "price", "2019-03-25T15:00:00Z", 300_000);
  await lose("D", "duplicate", "2019-03-26T15:00:00Z", 900_000);
  await service.from("opportunities").update({ estimated_value_cents: 700_000 }).eq("id", deals.E!);
  await win("F", 400_000, "2019-04-02T15:00:00Z");
});

afterAll(async () => {
  for (const id of customers) {
    const { data: jobs } = await service.from("jobs").select("id").eq("customer_id", id);
    for (const j of jobs ?? []) await service.from("jobs").delete().eq("id", j.id);
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
  await service.from("lead_sources").delete().eq("id", sourceId);
  await service.auth.admin.deleteUser(repId);
});

describe("report_dashboard", () => {
  it("returns the hand-computed tiles for the rep in March 2019", async () => {
    const { data, error } = await rep.rpc("report_dashboard", { p_from: FROM, p_to: TO, p_owner: repId });
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        new_leads: 3, // A, C, E (B now belongs to someone else; D is a duplicate; F was created in February)
        won_count: 2, // A (won at 23:30 on the last day) and B (counts for the owner at close)
        lost_count: 1, // C; the duplicate is excluded
        close_rate: 0.6667,
        sold_cents: 1_500_000,
        pipeline_cents: 700_000, // E
        active_jobs: 2, // A and F; B's deal has a different owner now
        upcoming_appointments: 0,
        invoiced_cents: 0,
        outstanding_cents: 0,
      },
    ]);
  });

  it("with no owner covers everyone, and April picks up only the deal won in April", async () => {
    const all = (await rep.rpc("report_dashboard", { p_from: FROM, p_to: TO })).data![0]!;
    expect(all).toMatchObject({ new_leads: 4, won_count: 2, lost_count: 1, sold_cents: 1_500_000 }); // B counts as a lead again
    const april = (await rep.rpc("report_dashboard", { p_from: "2019-04-01", p_to: "2019-04-30", p_owner: repId })).data![0]!;
    expect(april).toMatchObject({ new_leads: 0, won_count: 1, lost_count: 0, close_rate: 1, sold_cents: 400_000 });
    const empty = (await rep.rpc("report_dashboard", { p_from: "2018-01-01", p_to: "2018-01-31", p_owner: repId })).data![0]!;
    expect(empty).toMatchObject({ new_leads: 0, won_count: 0, lost_count: 0, close_rate: null, sold_cents: 0 });
  });

  it("gives field users nothing, because they cannot read deals", async () => {
    const { data } = await field.rpc("report_dashboard", { p_from: FROM, p_to: TO });
    expect(data![0]).toMatchObject({ new_leads: 0, won_count: 0, sold_cents: 0, pipeline_cents: 0, active_jobs: 0 });
    expect((await field.rpc("report_leads_by_source", { p_from: FROM, p_to: TO })).data).toEqual([]);
    expect((await field.rpc("report_lost_reasons", { p_from: FROM, p_to: TO })).data).toEqual([]);
  });
});

describe("report tables", () => {
  it("leads by source: a cohort of deals created in the period, duplicates excluded", async () => {
    const { data } = await sales.rpc("report_leads_by_source", { p_from: FROM, p_to: TO });
    expect(data).toEqual([{ source: sourceName, leads: 4, won: 2, lost: 1, open: 1, cohort_conversion: 0.5, sold_cents: 1_500_000 }]);
  });

  it("rep performance: closed results go to the owner at close; speed to lead uses the first attempt", async () => {
    const { data } = await sales.rpc("report_rep_performance", { p_from: FROM, p_to: TO });
    const row = data!.find((r) => r.owner_id === repId);
    expect(row).toEqual({
      owner_id: repId,
      owner_name: "Rep Orter",
      leads_assigned: 3,
      won: 2,
      lost: 1,
      close_rate: 0.6667,
      sold_cents: 1_500_000,
      avg_days_to_close: 18.3, // A: 26.52 days, B: 10 days
      median_minutes_to_first_attempt: 21, // A: 12 minutes (the no-answer call, not the connection 3 hours in), C: 30
      overdue_tasks: 0,
    });
    // The rep who was handed B after the win gets no credit for it in this period.
    const other = data!.find((r) => r.owner_id === salesId)!;
    expect(other).toMatchObject({ won: 0, sold_cents: 0 });
    expect(other.leads_assigned).toBe(1); // B, by current owner
  });

  it("lost reasons: the duplicate is not a reason", async () => {
    expect((await sales.rpc("report_lost_reasons", { p_from: FROM, p_to: TO })).data).toEqual([{ reason: "price", deals: 1, value_cents: 300_000 }]);
  });

  it("pipeline by stage: the rep's open deals now", async () => {
    const { data } = await sales.rpc("report_pipeline_by_stage", { p_owner: repId });
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ stage: "new", deals: 1, value_cents: 700_000 });
    expect(Number(data![0]!.avg_days_in_stage)).toBeGreaterThanOrEqual(0);
  });

  it("revenue by month: a deal won at 23:30 on the last day of last month counts in that month", async () => {
    const now = new Date();
    const firstOfThisMonth = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(now) + "-01";
    const lastDay = new Date(`${firstOfThisMonth}T00:00:00Z`);
    lastDay.setUTCDate(0);
    const lastDayText = lastDay.toISOString().slice(0, 10);
    const month = `${lastDayText.slice(0, 7)}-01`;
    const before = (await sales.rpc("report_revenue_by_month", { p_months: 3 })).data!.find((r) => r.month === month) ?? { won_count: 0, sold_cents: 0 };

    await lead("G", new Date(lastDay.getTime() - 5 * 86_400_000).toISOString());
    await win("G", 250_000, fromZonedTime(`${lastDayText}T23:30:00`, timeZone).toISOString());

    const after = (await sales.rpc("report_revenue_by_month", { p_months: 3 })).data!.find((r) => r.month === month)!;
    expect(after.won_count - before.won_count).toBe(1);
    expect(after.sold_cents - before.sold_cents).toBe(250_000);
    // 2019 is far outside the window
    expect((await sales.rpc("report_revenue_by_month", { p_months: 12 })).data!.every((r) => r.month > "2019-12-31")).toBe(true);
  });
});
