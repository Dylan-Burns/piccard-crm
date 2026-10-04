"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentProfileWithRole } from "@/lib/auth";
import { sendFromMailbox, syncAccount } from "@/lib/integrations/email/mailbox";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");

const sendSchema = z.object({
  opportunity_id: z.uuid(),
  subject: z.string().trim().min(1, "Enter a subject").max(300),
  body: z.string().trim().min(1, "Write a message").max(50_000),
});

/** Sends an email to the deal's customer from the signed-in user's own mailbox and logs it on the deal. */
export async function sendDealEmail(_prev: ActionResult<{ to: string }> | null, formData: FormData): Promise<ActionResult<{ to: string }>> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = sendSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  // The user's own client decides whether they may see this deal.
  const supabase = await createClient();
  const { data: deal } = await supabase.from("opportunities").select("id").eq("id", parsed.data.opportunity_id).maybeSingle();
  if (!deal) return NOT_ALLOWED;

  const result = await sendFromMailbox(me.id, { opportunityId: deal.id, subject: parsed.data.subject, body: parsed.data.body });
  if (!result.ok) return fail(result.code, result.message);
  revalidatePath(`/opportunities/${deal.id}`);
  revalidatePath("/customers", "layout");
  return ok({ to: result.to });
}

/** Looks in the signed-in user's mailbox for email to or from this deal's customer. */
export async function checkDealEmail(_prev: ActionResult<{ stored: number }> | null, formData: FormData): Promise<ActionResult<{ stored: number }>> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const id = z.uuid().safeParse(formData.get("opportunity_id"));
  if (!id.success) return fail("invalid", "Unknown deal");
  const supabase = await createClient();
  const [{ data: deal }, { data: account }] = await Promise.all([
    supabase.from("opportunities").select("id, customer:customers!inner(email)").eq("id", id.data).maybeSingle(),
    supabase.from("email_accounts").select("id, status").eq("user_id", me.id).maybeSingle(),
  ]);
  if (!deal) return NOT_ALLOWED;
  if (!account || account.status !== "connected") return fail("not_linked", "Link your email account first");
  if (!deal.customer.email) return fail("no_email", "This customer has no email address");

  const result = await syncAccount(account.id, { customerEmail: deal.customer.email });
  if (result.error) return fail("failed", result.error);
  revalidatePath(`/opportunities/${deal.id}`);
  return ok({ stored: result.stored });
}

/** Unlinks the signed-in user's own mailbox. Email already on deals stays there. */
export async function disconnectMailbox(_prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const supabase = await createClient();
  const { error } = await supabase.rpc("disconnect_email_account");
  if (error) return fail("failed", "Could not unlink the mailbox");
  revalidatePath("/settings/profile");
  return ok();
}
