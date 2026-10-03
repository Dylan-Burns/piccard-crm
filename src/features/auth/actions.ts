"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { z } from "zod";
import { homeFor } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

export async function signIn(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // Banned (deactivated) users get a distinct error from the auth server.
    if (error.code === "user_banned") return fail("deactivated", "This account has been deactivated. Contact an admin.");
    return fail("invalid_credentials", "Incorrect email or password");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", signedIn.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return fail("deactivated", "This account has been deactivated. Contact an admin.");
  }

  redirect(safeRedirectPath(parsed.data.next) ?? homeFor(profile.role));
}

const resetSchema = z.object({
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
});

export async function requestPasswordReset(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Enter a valid email", fieldErrors(parsed.error.issues));

  const supabase = await createClient();
  // The recovery email template builds its own /auth/confirm link; redirectTo is a fallback.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${appUrl()}/auth/confirm?next=/set-password`,
  });
  // Same response whether or not the account exists, to avoid leaking which emails are registered.
  return ok();
}

const setPasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

const LINK_TYPES: EmailOtpType[] = ["invite", "recovery"];
const LINK_ERROR = "That link is invalid or has expired. Ask an admin for a new one, or use Forgot password on the sign-in page.";

/** Verifies an invite or reset link. Called by the Continue button on /auth/confirm (never on GET). */
export async function confirmEmailLink(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "") as EmailOtpType;
  const code = String(formData.get("code") ?? "");
  const next = safeRedirectPath(String(formData.get("next") ?? "")) ?? "/";

  const supabase = await createClient();
  let verified = false;
  if (tokenHash && LINK_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    verified = !error;
  } else if (code) {
    // Supabase's built-in email templates (used until custom SMTP is configured) return a PKCE code,
    // which only works in the browser that requested it.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  }
  if (!verified) return fail("link", LINK_ERROR);
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function setPassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = setPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return fail("no_session", "Your link has expired. Request a new one from the sign-in page.");
  // This form skips the current-password check, so it only works for sessions that came from an
  // invite or reset link. A password-based session must use Settings → Profile instead.
  const methods = (claims.claims.amr ?? []).map((entry) => (typeof entry === "string" ? entry : entry.method));
  if (methods.includes("password")) {
    return fail("reauth_required", "To change your password, go to Settings → Profile and enter your current password.");
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return fail("same_password", "Choose a password different from your current one");
    return fail("update_failed", error.message);
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", claims.claims.sub).maybeSingle();
  redirect(profile ? homeFor(profile.role) : "/login");
}
