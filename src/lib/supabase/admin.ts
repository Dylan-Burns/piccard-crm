import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Service-role client. BYPASSES RLS.
 * Allowed only in: webhook routes, cron routes, integration workers, the public
 * estimate page and its actions, storage URL signing, and user invitation (CLAUDE.md rule 4).
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
