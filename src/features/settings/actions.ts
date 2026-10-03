"use server";

import { revalidatePath } from "next/cache";
import { currentProfileWithRole } from "@/lib/auth";
import { appUrl } from "@/lib/env";
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

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return fail("same_password", "Choose a password different from your current one");
    return fail("update_failed", error.message);
  }
  return ok();
}

// ---------------------------------------------------------------------------
// Users (admin)
// ---------------------------------------------------------------------------

export async function inviteUser(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { email, full_name, role } = parsed.data;

  // Service client is allowed for user invitation (CLAUDE.md rule 4).
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
    redirectTo: `${appUrl()}/auth/confirm?next=/set-password`,
  });
  if (error || !data.user) {
    if (error?.code === "email_exists" || error?.status === 422) {
      return fail("email_exists", "A user with that email already exists", { email: "Already invited or registered" });
    }
    return fail("invite_failed", error?.message ?? "Could not send the invitation");
  }

  // The auth trigger created the profile with role 'field'; set the real role and name.
  const { error: roleError } = await admin.from("profiles").update({ role, full_name }).eq("id", data.user.id);
  if (roleError) return fail("role_failed", "Invitation sent, but setting the role failed. Change it in the list.");

  revalidatePath("/settings/users");
  return ok();
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
