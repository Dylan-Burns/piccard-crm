/**
 * Sample CRM data for local development and tests (spec §9 Phase 2 step 5).
 * Inserted with the service client, which bypasses RLS and column grants.
 * Tests look fixtures up by the names exported in FIXTURES.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

type Client = SupabaseClient<Database>;
type Stage = Database["public"]["Enums"]["opportunity_stage"];
type WorkType = Database["public"]["Enums"]["work_type"];

export const FIXTURES = {
  /** Open deal with a scheduled inspection assigned to field@test.local. */
  inspectionDeal: "Roof Replacement — 12 Maple Ave",
  /** Won deal whose job is assigned to field@test.local. Has a photo and an estimate file. */
  wonDeal: "Roof Replacement — 123 Main Street",
  /** Open deal the field user has no connection to. */
  unassignedDeal: "Gutters — 88 Birch Ln",
  /** Deal in estimate_sent with a sent four-line estimate. */
  estimateDeal: "Roof Repair — 7 Cedar Ct",
} as const;

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null) throw new Error(`${what}: ${result.error?.message ?? "no data"}`);
  return result.data;
}

const PEOPLE: [string, string, string, string, string][] = [
  // first, last, phone, street, city
  ["John", "Smith", "+14155550101", "123 Main Street", "Springfield"],
  ["Maria", "Garcia", "+14155550102", "12 Maple Ave", "Springfield"],
  ["David", "Chen", "+14155550103", "88 Birch Ln", "Shelbyville"],
  ["Sarah", "Johnson", "+14155550104", "7 Cedar Ct", "Springfield"],
  ["Mike", "O'Brien", "+14155550105", "450 Oak St", "Shelbyville"],
  ["Linda", "Nguyen", "+14155550106", "9 Elm Dr", "Springfield"],
  ["Robert", "Patel", "+14155550107", "31 Pine Rd", "Capital City"],
  ["Emily", "Davis", "+14155550108", "602 Walnut St", "Springfield"],
  ["James", "Wilson", "+14155550109", "15 Spruce Way", "Shelbyville"],
  ["Karen", "Martinez", "+14155550110", "77 Willow Ct", "Capital City"],
  ["Tom", "Anderson", "+14155550111", "240 Aspen Blvd", "Springfield"],
  ["Priya", "Shah", "+14155550112", "5 Poplar Pl", "Shelbyville"],
];

// [customer index, title prefix, work type, stage, value in dollars, owner key]
const DEALS: [number, string, WorkType, Stage, number, "sales" | "admin" | null][] = [
  [0, "Roof Replacement", "roof_replacement", "won", 24800, "sales"],
  [1, "Roof Replacement", "roof_replacement", "inspection_scheduled", 21000, "sales"],
  [2, "Gutters", "gutters", "qualified", 3200, "sales"],
  [3, "Roof Repair", "roof_repair", "estimate_sent", 4850, "sales"],
  [4, "Roof Replacement", "roof_replacement", "new", 0, null],
  [5, "Siding", "siding", "new", 0, "sales"],
  [6, "Renovation", "renovation", "new", 0, "admin"],
  [7, "Roof Repair", "roof_repair", "new", 0, null],
  [8, "Roof Replacement", "roof_replacement", "contacted", 18000, "sales"],
  [9, "Gutters", "gutters", "contacted", 2500, "admin"],
  [10, "Roof Repair", "roof_repair", "contacted", 1200, "sales"],
  [11, "Roof Replacement", "roof_replacement", "qualified", 26500, "admin"],
  [4, "Siding", "siding", "qualified", 14000, "sales"],
  [5, "Roof Replacement", "roof_replacement", "inspection_scheduled", 23000, "admin"],
  [6, "Roof Repair", "roof_repair", "estimate_sent", 3900, "admin"],
  [7, "Renovation", "renovation", "negotiation", 41000, "sales"],
  [8, "Gutters", "gutters", "won", 2900, "sales"],
  [9, "Roof Repair", "roof_repair", "won", 5200, "admin"],
  [10, "Roof Replacement", "roof_replacement", "lost", 19500, "sales"],
  [11, "Siding", "siding", "lost", 12000, "admin"],
];

export async function seedData(db: Client, users: Record<"admin" | "sales" | "field" | "field2", string>) {
  const { count } = await db.from("customers").select("id", { count: "exact", head: true });
  if (count && count > 0) {
    console.log("sample data already present; run `supabase db reset` first to reseed");
    return;
  }

  const sources = must(await db.from("lead_sources").select("id, name"), "lead sources");
  const source = (name: string) => sources.find((s) => s.name === name)!.id;

  // Customers and properties (customer 0 owns two properties)
  const customers = must(
    await db
      .from("customers")
      .insert(
        PEOPLE.map(([first_name, last_name, phone_e164]) => ({
          first_name,
          last_name,
          phone: phone_e164.replace("+1", ""),
          phone_e164,
          email: `${first_name}.${last_name}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com",
          created_by: users.sales,
        })),
      )
      .select("id"),
    "customers",
  );
  const properties = must(
    await db
      .from("properties")
      .insert([
        ...PEOPLE.map(([, , , address_line1, city], i) => ({
          customer_id: customers[i]!.id,
          address_line1,
          city,
          state: "IL",
          postal_code: `627${String(i).padStart(2, "0")}`,
          is_primary: true,
        })),
        { customer_id: customers[0]!.id, label: "Rental", address_line1: "9 Lake Shore Dr", city: "Springfield", state: "IL", postal_code: "62799", is_primary: false },
      ])
      .select("id, customer_id, address_line1"),
    "properties",
  );
  const primaryProperty = (i: number) => properties[i]!;

  // Opportunities
  const sourceCycle = ["Website", "Google Ads", "Referral", "Phone Call", "Yard Sign"];
  const opportunities = must(
    await db
      .from("opportunities")
      .insert(
        DEALS.map(([c, prefix, work_type, stage, dollars, owner], i) => {
          const property = primaryProperty(c);
          const owner_id = owner ? users[owner] : null;
          const closed = stage === "won" || stage === "lost";
          return {
            customer_id: customers[c]!.id,
            property_id: property.id,
            title: `${prefix} — ${property.address_line1}`,
            work_type,
            stage,
            owner_id,
            source_id: source(sourceCycle[i % sourceCycle.length]!),
            estimated_value_cents: dollars ? dollars * 100 : null,
            amount_cents: stage === "won" ? dollars * 100 : null,
            won_at: stage === "won" ? days(-10 - i) : null,
            lost_at: stage === "lost" ? days(-6 - i) : null,
            lost_reason: stage === "lost" ? (i % 2 === 0 ? ("price" as const) : ("competitor" as const)) : null,
            closed_owner_id: closed ? owner_id : null,
            closed_by: closed ? owner_id : null,
            first_contact_attempted_at: stage === "new" ? null : days(-20 - i),
            first_contact_attempted_by: stage === "new" ? null : owner_id,
            first_contacted_at: stage === "new" ? null : days(-19 - i),
            created_by: users.sales,
            created_at: days(-21 - i),
          };
        }),
      )
      .select("id, title, stage, customer_id, property_id, owner_id"),
    "opportunities",
  );
  const deal = (title: string) => {
    const found = opportunities.find((o) => o.title === title);
    if (!found) throw new Error(`fixture deal not found: ${title}`);
    return found;
  };
  const inspectionDeal = deal(FIXTURES.inspectionDeal);
  const wonDeal = deal(FIXTURES.wonDeal);
  const estimateDeal = deal(FIXTURES.estimateDeal);

  // Inspections: one for the field user, one for sales
  must(
    await db
      .from("appointments")
      .insert([
        { type: "inspection", title: "Inspection: Maria Garcia", opportunity_id: inspectionDeal.id, customer_id: inspectionDeal.customer_id, assigned_to: users.field, starts_at: days(2), ends_at: new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString(), created_by: users.sales },
        { type: "inspection", title: "Inspection: Linda Nguyen", opportunity_id: opportunities[13]!.id, customer_id: opportunities[13]!.customer_id, assigned_to: users.sales, starts_at: days(3), ends_at: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(), created_by: users.admin },
      ])
      .select("id"),
    "appointments",
  );

  // Estimate with four lines on the estimate_sent deal; lines go in while it is a draft.
  const [estimate] = must(
    await db
      .from("estimates")
      .insert({ opportunity_id: estimateDeal.id, title: "Roof repair — rear slope", tax_rate: 0, deposit_percent: 30, created_by: users.sales })
      .select("id"),
    "estimate",
  );
  must(
    await db
      .from("estimate_line_items")
      .insert([
        { estimate_id: estimate!.id, sort_order: 1, name: "Tear-off and disposal", quantity: 6, unit: "sq", unit_price_cents: 15000, is_taxable: true },
        { estimate_id: estimate!.id, sort_order: 2, name: "Architectural shingles", quantity: 6, unit: "sq", unit_price_cents: 42500, is_taxable: true },
        { estimate_id: estimate!.id, sort_order: 3, name: "Step flashing", quantity: 40, unit: "lf", unit_price_cents: 1500, is_taxable: true },
        { estimate_id: estimate!.id, sort_order: 4, name: "Pipe boots", quantity: 2, unit: "ea", unit_price_cents: 20000, is_taxable: false },
      ])
      .select("id"),
    "estimate lines",
  );
  must(await db.from("estimates").update({ status: "sent", sent_at: days(-2), sent_to_email: "sarah.johnson@example.com" }).eq("id", estimate!.id).select("id"), "send estimate");

  // Job for the won deal, assigned to the field user
  const [job] = must(
    await db
      .from("jobs")
      .insert({ opportunity_id: wonDeal.id, customer_id: wonDeal.customer_id, property_id: wonDeal.property_id!, title: wonDeal.title, work_type: "roof_replacement", status: "scheduled", scheduled_start: days(5).slice(0, 10), scheduled_end: days(7).slice(0, 10), warranty_years: 5, scope_summary: "28 sq tear-off and replace\nNew ridge vent\nReplace 4 pipe boots" })
      .select("id"),
    "job",
  );
  must(await db.from("job_assignments").insert({ job_id: job!.id, user_id: users.field }).select("job_id"), "job assignment");

  // Files on the won deal: a photo (field may see) and an estimate PDF (field may not)
  must(
    await db
      .from("files")
      .insert([
        { opportunity_id: wonDeal.id, customer_id: wonDeal.customer_id, category: "photo", storage_path: `seed/${wonDeal.id}/photo-1.jpg`, file_name: "front-slope.jpg", mime_type: "image/jpeg", size_bytes: 482113, uploaded_by: users.sales },
        { opportunity_id: wonDeal.id, customer_id: wonDeal.customer_id, category: "estimate", storage_path: `seed/${wonDeal.id}/estimate.pdf`, file_name: "E-1000.pdf", mime_type: "application/pdf", size_bytes: 88211, uploaded_by: users.sales },
      ])
      .select("id"),
    "files",
  );

  // Notes (the trigger adds a timeline entry for each)
  must(
    await db
      .from("notes")
      .insert([
        { opportunity_id: wonDeal.id, customer_id: wonDeal.customer_id, author_id: users.sales, body: "Customer prefers morning arrivals. Dog in back yard.", shared_with_crew: true },
        { opportunity_id: inspectionDeal.id, customer_id: inspectionDeal.customer_id, author_id: users.sales, body: "Leak over the kitchen after heavy rain.", shared_with_crew: true },
        { opportunity_id: estimateDeal.id, customer_id: estimateDeal.customer_id, author_id: users.sales, body: "Comparing with one other quote.", shared_with_crew: false },
      ])
      .select("id"),
    "notes",
  );

  // Tasks: some overdue, some upcoming, one for the field user
  const open = opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
  must(
    await db
      .from("tasks")
      .insert([
        ...open.slice(0, 8).map((o, i) => ({
          title: i % 2 === 0 ? "Follow up" : "Call back",
          opportunity_id: o.id,
          customer_id: o.customer_id,
          assigned_to: o.owner_id ?? users.admin,
          due_at: days(i < 3 ? -2 - i : 1 + i),
          created_by: users.sales,
        })),
        { title: "Upload completion photos", job_id: job!.id, assigned_to: users.field, due_at: days(8), created_by: users.admin },
      ])
      .select("id"),
    "tasks",
  );

  console.log(`seeded ${customers.length} customers, ${properties.length} properties, ${opportunities.length} deals`);
}
