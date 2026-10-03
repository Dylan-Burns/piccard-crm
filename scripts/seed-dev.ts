/**
 * Dev seed: creates the three test users and sets their roles.
 * Local Supabase only. Run with `pnpm seed` after `supabase db reset`.
 */
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import type { Database } from "../src/types/database";

loadEnv({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local");

const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing to seed a non-local database (${host}).`);
}

export const SEED_PASSWORD = "Password123!";
export const SEED_USERS = [
  { email: "admin@test.local", full_name: "Alex Admin", role: "admin" },
  { email: "sales@test.local", full_name: "Sam Sales", role: "sales" },
  { email: "field@test.local", full_name: "Fran Field", role: "field" },
] as const;

const admin = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;

  for (const user of SEED_USERS) {
    let id = existing.users.find((u) => u.email === user.email)?.id;
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: SEED_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: user.full_name },
      });
      if (error) throw error;
      id = data.user.id;
    }
    const { error } = await admin
      .from("profiles")
      .update({ role: user.role, full_name: user.full_name, is_active: true })
      .eq("id", id);
    if (error) throw error;
    console.log(`seeded ${user.email} (${user.role})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
