"use server";

import { revalidatePath } from "next/cache";
import { processSubmission, receiveLead, retryLeadSubmissions } from "@/features/leads/ingest";
import { currentProfileWithRole } from "@/lib/auth";
import { retryEmails } from "@/lib/integrations/resend";
import { fail, ok, type ActionResult } from "@/lib/result";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");

/** Pushes a clearly-labelled test lead through the same path a website submission takes. */
export async function sendTestLead(_prev: ActionResult<{ status: string }> | null, _formData: FormData): Promise<ActionResult<{ status: string }>> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const stamp = Date.now();
  const body = JSON.stringify({
    submission_id: `test-${stamp}`,
    name: "Test Lead",
    phone: `555-01${String(stamp).slice(-2)}`,
    email: `test-lead-${stamp}@example.com`,
    address: `${String(stamp).slice(-4)} Test Street`,
    service: "Roof repair",
    message: "This is a test lead sent from Settings. Mark it lost (duplicate) when you are done.",
    form_name: "Settings test",
  });
  const received = await receiveLead("website", body, null);
  if (!received.submissionId) return fail("failed", "The test lead could not be stored");
  const status = await processSubmission(received.submissionId);
  revalidatePath("/settings/integrations");
  revalidatePath("/leads");
  if (status !== "created" && status !== "merged_duplicate") return fail("failed", `The test lead was stored but ended as "${status}"`);
  return ok({ status });
}

export async function retrySubmission(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const id = String(formData.get("submission_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("invalid", "Invalid submission");
  const status = await processSubmission(id);
  revalidatePath("/settings/integrations");
  return status === "error" ? fail("failed", "It failed again. See the error in the table.") : ok();
}

/** Runs the retry sweep on demand (the same work the cron route does). */
export async function runRetries(_prev: ActionResult<{ leads: number; emails: number }> | null, _formData: FormData): Promise<ActionResult<{ leads: number; emails: number }>> {
  const me = await currentProfileWithRole("admin");
  if (!me) return NOT_ALLOWED;
  const leads = await retryLeadSubmissions();
  const emails = await retryEmails();
  revalidatePath("/settings/integrations");
  return ok({ leads: leads.retried, emails: emails.sent });
}
