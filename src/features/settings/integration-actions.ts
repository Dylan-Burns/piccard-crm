"use server";

import { revalidatePath } from "next/cache";
import { processSubmission, receiveLead, retryLeadSubmissions } from "@/features/leads/ingest";
import { currentProfileWithRole } from "@/lib/auth";
import { after } from "next/server";
import { enqueueAppointments } from "@/lib/integrations/google-calendar";
import { processOutbox } from "@/lib/integrations/outbox";
import { listQboOptions } from "@/lib/integrations/quickbooks";
import { retryEmails } from "@/lib/integrations/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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

// ---------------------------------------------------------------------------
// Google Calendar (admin). These use the service client: the connection and the outbox are
// service-role tables, and this is the admin-gated integration settings screen (CLAUDE.md rule 4).
// ---------------------------------------------------------------------------

/** Stops syncing and forgets the tokens. The calendar id is kept so a reconnect reuses the same calendar. */
export async function disconnectGoogle(_prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const { error } = await createAdminClient()
    .from("integration_connections")
    .update({ status: "disconnected", access_token_enc: null, refresh_token_enc: null, expires_at: null, last_error: null })
    .eq("provider", "google_calendar");
  if (error) return fail("failed", "Could not disconnect Google Calendar");
  revalidatePath("/", "layout");
  return ok();
}

/** Queues every future scheduled appointment and starts sending them. */
export async function backfillGoogle(_prev: ActionResult<{ queued: number }> | null, _formData: FormData): Promise<ActionResult<{ queued: number }>> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  try {
    const queued = await enqueueAppointments(null);
    after(() => processOutbox());
    revalidatePath("/settings/integrations");
    return ok({ queued });
  } catch {
    return fail("failed", "Could not queue the appointments");
  }
}

/** Tries a failed appointment again. */
export async function retryGoogleSync(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const id = String(formData.get("appointment_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("invalid", "Unknown appointment");
  try {
    await enqueueAppointments(null, [id]);
    await processOutbox();
    revalidatePath("/settings/integrations");
    return ok();
  } catch {
    return fail("failed", "Could not retry the sync");
  }
}

// ---------------------------------------------------------------------------
// QuickBooks (admin)
// ---------------------------------------------------------------------------

/** Stops syncing and forgets the tokens. The chosen item is kept for a later reconnect to the same company. */
export async function disconnectQuickBooks(_prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const { error } = await createAdminClient()
    .from("integration_connections")
    .update({ status: "disconnected", access_token_enc: null, refresh_token_enc: null, expires_at: null, last_error: null })
    .eq("provider", "quickbooks");
  if (error) return fail("failed", "Could not disconnect QuickBooks");
  revalidatePath("/", "layout");
  return ok();
}

/** Saves the income item (and, only if tax is charged, the tax code), chosen from QuickBooks' own lists. */
export async function saveQuickBooksConfig(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const itemId = String(formData.get("item_id") ?? "");
  const taxCodeId = String(formData.get("tax_code_id") ?? "");
  if (!itemId) return fail("invalid", "Choose the income item");
  try {
    // The ids must be ones QuickBooks actually offers, not whatever the form sent.
    const options = await listQboOptions();
    const item = options.items.find((i) => i.id === itemId);
    const taxCode = taxCodeId ? options.taxCodes.find((t) => t.id === taxCodeId) : null;
    if (!item || (taxCodeId && !taxCode)) return fail("invalid", "Choose from the lists QuickBooks provides");
    const db = createAdminClient();
    const { data: row } = await db.from("integration_connections").select("config").eq("provider", "quickbooks").single();
    const config = { ...((row?.config ?? {}) as Record<string, unknown>), item_id: item.id, item_name: item.name, tax_code_id: taxCode?.id ?? null, tax_code_name: taxCode?.name ?? null };
    const { error } = await db.from("integration_connections").update({ config }).eq("provider", "quickbooks");
    if (error) return fail("failed", "Could not save the QuickBooks settings");
    revalidatePath("/settings/integrations");
    return ok();
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Could not reach QuickBooks");
  }
}

/** Tries a failed invoice again. */
export async function retryInvoiceSync(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const id = String(formData.get("invoice_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("invalid", "Unknown invoice");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("queue_invoice_sync", { p_invoice_id: id });
  const result = data as { ok?: boolean; message?: string } | null;
  if (error || !result?.ok) return fail("failed", result?.message ?? "Could not retry the invoice");
  await processOutbox();
  revalidatePath("/settings/integrations");
  return ok();
}
