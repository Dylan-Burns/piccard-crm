"use server";

import { createClient as createPlainClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { currentProfileWithRole } from "@/lib/auth";
import { publicEnv, resolveOrigin } from "@/lib/env";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  activeChangeSchema,
  changePasswordSchema,
  companySchema,
  inviteSchema,
  percentToRate,
  profileSchema,
  roleChangeSchema,
} from "@/features/settings/schemas";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");

// ---------------------------------------------------------------------------
// Own profile (any role)
// ---------------------------------------------------------------------------

export async function updateOwnProfile(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole();
  if (!me) return NOT_ALLOWED;
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", me.id);
  if (error) return fail("update_failed", "Could not save your profile");

  revalidatePath("/", "layout");
  return ok();
}

export async function changePassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole();
  if (!me) return NOT_ALLOWED;
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));

  // Re-authenticate with the current password on a throwaway client, so a hijacked session
  // alone cannot change the password.
  const env = publicEnv();
  const verifier = createPlainClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: me.email,
    password: parsed.data.current_password,
  });
  if (verifyError) {
    return fail("invalid", "Check the highlighted fields", { current_password: "Current password is incorrect" });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return fail("invalid", "Check the highlighted fields", { password: "Choose a different password" });
    }
    return fail("update_failed", error.message);
  }
  return ok();
}

// ---------------------------------------------------------------------------
// Users (admin)
// ---------------------------------------------------------------------------

/** Builds the app's own confirm link from a hashed token, so no email provider is needed. */
async function confirmLink(hashedToken: string, type: "invite" | "recovery"): Promise<string> {
  const h = await headers();
  // Only trust the Host header when it matches an origin this deployment is served from.
  const origin = resolveOrigin(h.get("host"), h.get("x-forwarded-proto"));
  const params = new URLSearchParams({ next: "/set-password", token_hash: hashedToken, type });
  return `${origin}/auth/confirm?${params.toString()}`;
}

export type LinkResult = { link: string; email: string };

export async function inviteUser(_prev: ActionResult<LinkResult> | null, formData: FormData): Promise<ActionResult<LinkResult>> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { email, full_name, role } = parsed.data;

  // Service client is allowed for user invitation (CLAUDE.md rule 4).
  const admin = createAdminClient();
  // generateLink creates the invited user and returns a token without sending email. The admin
  // shares the link. (Supabase's built-in email only reaches org members; a branded email is
  // added with Resend in Phase 5.)
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name } },
  });
  if (error || !data.user || !data.properties?.hashed_token) {
    if (error?.code === "email_exists" || error?.status === 422) {
      return fail("email_exists", "A user with that email already exists", { email: "Already invited or registered" });
    }
    return fail("invite_failed", error?.message ?? "Could not send the invitation");
  }

  // The auth trigger created the profile with role 'field'; set the real role and name.
  const { error: roleError } = await admin.from("profiles").update({ role, full_name }).eq("id", data.user.id);
  if (roleError) return fail("role_failed", "Invitation sent, but setting the role failed. Change it in the list.");

  revalidatePath("/settings/users");
  return ok({ link: await confirmLink(data.properties.hashed_token, "invite"), email });
}

/** Admin fallback for a user who cannot receive a reset email: returns a one-time reset link. */
export async function createResetLink(_prev: ActionResult<LinkResult> | null, formData: FormData): Promise<ActionResult<LinkResult>> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const userId = formData.get("user_id");
  if (typeof userId !== "string") return fail("invalid", "Invalid request");

  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("email, is_active").eq("id", userId).maybeSingle();
  if (!target || !target.is_active) return fail("not_found", "That user is not active");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: target.email });
  if (error || !data.properties?.hashed_token) return fail("link_failed", error?.message ?? "Could not create a reset link");

  return ok({ link: await confirmLink(data.properties.hashed_token, "recovery"), email: target.email });
}

export async function updateUserRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const parsed = roleChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Invalid role change");
  if (parsed.data.user_id === me.id) return fail("self", "You cannot change your own role");

  // User-scoped client: RLS and guard_profile_privileges both allow admins.
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role: parsed.data.role }).eq("id", parsed.data.user_id);
  if (error) return fail("update_failed", "Could not change the role");

  revalidatePath("/settings/users");
  return ok();
}

export async function setUserActive(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const parsed = activeChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Invalid request");
  const { user_id, is_active } = parsed.data;
  if (user_id === me.id) return fail("self", "You cannot deactivate yourself");

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ is_active }).eq("id", user_id);
  if (error) return fail("update_failed", "Could not update the user");

  // Ban at the auth layer too, so a deactivated user cannot sign in or refresh a session.
  const admin = createAdminClient();
  const { error: banError } = await admin.auth.admin.updateUserById(user_id, {
    ban_duration: is_active ? "none" : "876000h",
  });
  if (banError) return fail("ban_failed", "Profile updated, but the sign-in block could not be changed");

  revalidatePath("/settings/users");
  return ok();
}

// ---------------------------------------------------------------------------
// Company settings (admin)
// ---------------------------------------------------------------------------

export async function updateCompany(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const raw = Object.fromEntries(formData);
  const parsed = companySchema.safeParse({ send_inspection_confirmation: "", ...raw });
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { default_tax_rate_percent, ...rest } = parsed.data;

  const supabase = await createClient();
  if (rest.default_lead_owner_id) {
    const { data: owner } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", rest.default_lead_owner_id)
      .in("role", ["admin", "sales"])
      .eq("is_active", true)
      .maybeSingle();
    if (!owner) return fail("invalid", "Check the highlighted fields", { default_lead_owner_id: "Choose an active admin or sales user" });
  }

  const { error } = await supabase
    .from("company_settings")
    .update({ ...rest, default_tax_rate: percentToRate(default_tax_rate_percent) })
    .eq("id", true);
  if (error) return fail("update_failed", "Could not save company settings");

  revalidatePath("/", "layout");
  return ok();
}

// ---------------------------------------------------------------------------
// Lead sources (admin)
// ---------------------------------------------------------------------------

/** The webhooks look these up by name (spec §2.2), so they cannot be renamed or removed. */
const PROTECTED_SOURCES = ["Website", "Google Ads"];

export async function addLeadSource(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 60) return fail("invalid", "Check the name", { name: "Enter a name up to 60 characters" });

  const supabase = await createClient();
  const { data: last } = await supabase.from("lead_sources").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("lead_sources").insert({ name, sort_order: (last?.sort_order ?? 0) + 10 });
  if (error) return fail("invalid", "Check the name", { name: error.code === "23505" ? "That source already exists" : "Could not add the source" });
  revalidatePath("/settings/lead-sources");
  return ok();
}

export async function updateLeadSource(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const supabase = await createClient();
  const { data: sources } = await supabase.from("lead_sources").select("id, name, is_active, sort_order").order("sort_order");
  const index = (sources ?? []).findIndex((s) => s.id === id);
  const source = sources?.[index];
  if (!sources || !source) return fail("not_found", "Source not found");

  if (intent === "toggle") {
    if (PROTECTED_SOURCES.includes(source.name)) return fail("protected", `${source.name} is used by automatic lead capture and stays on`);
    const { error } = await supabase.from("lead_sources").update({ is_active: !source.is_active }).eq("id", id);
    if (error) return fail("update_failed", "Could not update the source");
  } else if (intent === "rename") {
    if (PROTECTED_SOURCES.includes(source.name)) return fail("protected", `${source.name} cannot be renamed`);
    const name = String(formData.get("name") ?? "").trim();
    if (!name || name.length > 60) return fail("invalid", "Enter a name up to 60 characters");
    const { error } = await supabase.from("lead_sources").update({ name }).eq("id", id);
    if (error) return fail("update_failed", error.code === "23505" ? "That source already exists" : "Could not rename the source");
  } else if (intent === "up" || intent === "down") {
    const other = sources[intent === "up" ? index - 1 : index + 1];
    if (!other) return ok();
    // Swap positions. Two single-row writes; a failure between them only leaves two rows tied.
    const a = await supabase.from("lead_sources").update({ sort_order: other.sort_order }).eq("id", source.id);
    const b = await supabase.from("lead_sources").update({ sort_order: source.sort_order }).eq("id", other.id);
    if (a.error || b.error) return fail("update_failed", "Could not reorder");
  } else {
    return fail("invalid", "Unknown action");
  }
  revalidatePath("/settings/lead-sources");
  return ok();
}
