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
