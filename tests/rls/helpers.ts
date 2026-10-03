import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

if (!url || !/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error("RLS tests run only against local Supabase. Run `supabase start` and `pnpm seed`.");
}

export const SEED_PASSWORD = "Password123!";
export type Client = SupabaseClient<Database>;

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function anonClient(): Client {
  return createClient<Database>(url, publishableKey, options);
}

export function serviceClient(): Client {
  return createClient<Database>(url, secretKey, options);
}

/** Signs in as a seeded user (admin@test.local, sales@test.local, field@test.local). */
export async function signInAs(email: string): Promise<{ client: Client; userId: string }> {
  const client = createClient<Database>(url, publishableKey, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error || !data.user) throw new Error(`Sign-in failed for ${email}: ${error?.message}. Did you run \`pnpm seed\`?`);
  return { client, userId: data.user.id };
}

import { FIXTURES } from "../../scripts/seed-data";

/** Looks up the seeded fixture rows by name (see scripts/seed-data.ts). */
export async function loadFixtures() {
  const service = serviceClient();
  const { data: deals, error } = await service
    .from("opportunities")
    .select("id, title, customer_id, property_id, stage, owner_id")
    .in("title", Object.values(FIXTURES));
  if (error || !deals || deals.length !== Object.keys(FIXTURES).length) {
    throw new Error("Seed fixtures missing. Run `supabase db reset && pnpm seed`.");
  }
  const byTitle = (title: string) => deals.find((d) => d.title === title)!;
  const wonDeal = byTitle(FIXTURES.wonDeal);
  const { data: job } = await service.from("jobs").select("id").eq("opportunity_id", wonDeal.id).single();
  return {
    inspectionDeal: byTitle(FIXTURES.inspectionDeal),
    wonDeal,
    unassignedDeal: byTitle(FIXTURES.unassignedDeal),
    estimateDeal: byTitle(FIXTURES.estimateDeal),
    jobId: job!.id,
  };
}

export const ALL_TABLES = [
  "profiles", "company_settings", "lead_sources", "customers", "properties", "opportunities",
  "opportunity_stage_history", "lead_submissions", "price_book_items", "estimates", "estimate_line_items",
  "jobs", "job_assignments", "appointments", "invoices", "invoice_line_items", "notes", "files",
  "activities", "tasks", "integration_connections", "sync_outbox", "email_log",
] as const;

export const PERMISSION_DENIED = "42501";
