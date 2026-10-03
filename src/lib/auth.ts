import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type UserRole = Database["public"]["Enums"]["user_role"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const STAFF_ROLES = ["admin", "sales"] as const satisfies readonly UserRole[];
export const ALL_ROLES = ["admin", "sales", "field"] as const satisfies readonly UserRole[];

/** Landing page after sign-in, per role (spec §5.1). */
export function homeFor(role: UserRole): "/dashboard" | "/today" {
  return role === "field" ? "/today" : "/dashboard";
}

type SessionState =
  | { status: "anonymous" }
  | { status: "inactive"; userId: string } // signed in, but no active profile (deactivated)
  | { status: "active"; profile: Profile };

/**
 * Resolves the signed-in user's profile once per request.
 * The profiles select policy only returns rows for active users, so a signed-in
 * user with no visible profile is treated as deactivated.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { status: "anonymous" };

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!profile || !profile.is_active) return { status: "inactive", userId };
  return { status: "active", profile };
});

export async function getSessionProfile(): Promise<Profile | null> {
  const state = await getSessionState();
  return state.status === "active" ? state.profile : null;
}

/**
 * Gate for pages and server actions. Redirects when there is no active session,
 * and sends users whose role is not allowed to their own home page.
 */
export async function requireRole(...roles: UserRole[]): Promise<Profile> {
  const state = await getSessionState();
  if (state.status === "anonymous") redirect("/login");
  if (state.status === "inactive") redirect("/auth/signout?reason=deactivated");

  const { profile } = state;
  const allowed = roles.length === 0 ? ALL_ROLES : roles;
  if (!(allowed as readonly UserRole[]).includes(profile.role)) redirect(homeFor(profile.role));
  return profile;
}

/** For server actions that must return an ActionResult rather than redirect. */
export async function currentProfileWithRole(...roles: UserRole[]): Promise<Profile | null> {
  const profile = await getSessionProfile();
  if (!profile) return null;
  if (roles.length > 0 && !roles.includes(profile.role)) return null;
  return profile;
}
