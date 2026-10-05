"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { currentProfileWithRole } from "@/lib/auth";
import { processOutbox } from "@/lib/integrations/outbox";
import { parseDollarsToCents } from "@/lib/money";
import { fail, ok, type ActionResult } from "@/lib/result";
import { unwrapRpc, type RpcResult } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");
const ids = z.object({ invoiceId: z.uuid(), jobId: z.uuid() });

function revalidate(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/opportunities", "layout");
  revalidatePath("/dashboard");
}

/** Admin: a draft's due date (the only invoice column edited directly). */
export async function setInvoiceDueDate(input: unknown): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const parsed = ids.extend({ dueOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]) }).safeParse(input);
  if (!parsed.success) return fail("invalid", "Choose a date");
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").update({ due_on: parsed.data.dueOn || null }).eq("id", parsed.data.invoiceId).eq("status", "draft").select("id");
  if (error) return fail("failed", "Could not save the due date");
  if (data.length === 0) return fail("not_draft", "Only a draft invoice's due date can be changed");
  revalidate(parsed.data.jobId);
  return ok();
}

/** Runs one of the admin invoice RPCs and revalidates. */
async function run(jobId: string, call: (supabase: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const result = unwrapRpc<RpcResult>(await call(await createClient()));
  if (!result.ok) return result;
  revalidate(jobId);
  return ok();
}

export async function regenerateInvoices(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ jobId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("invalid", "Unknown job");
  return run(parsed.data.jobId, (supabase) => supabase.rpc("regenerate_job_invoices", { p_job_id: parsed.data.jobId }));
}

export async function voidInvoice(input: unknown): Promise<ActionResult> {
  const parsed = ids.safeParse(input);
  if (!parsed.success) return fail("invalid", "Unknown invoice");
  return run(parsed.data.jobId, (supabase) => supabase.rpc("void_invoice", { p_invoice_id: parsed.data.invoiceId }));
}

/** Manual path, for when the invoice is not in QuickBooks. */
export async function markInvoiceSent(input: unknown): Promise<ActionResult> {
  const parsed = ids.safeParse(input);
  if (!parsed.success) return fail("invalid", "Unknown invoice");
  return run(parsed.data.jobId, (supabase) => supabase.rpc("record_invoice_manually", { p_invoice_id: parsed.data.invoiceId, p_status: "sent" }));
}

/** Manual path: the total paid so far, in dollars. */
export async function recordInvoicePayment(input: unknown): Promise<ActionResult> {
  const parsed = ids.extend({ amountPaid: z.string() }).safeParse(input);
  if (!parsed.success) return fail("invalid", "Unknown invoice");
  const cents = parseDollarsToCents(parsed.data.amountPaid.trim() === "" ? "0" : parsed.data.amountPaid);
  if (cents === null) return fail("invalid", "Enter the amount paid so far, such as 7,440.00");
  return run(parsed.data.jobId, (supabase) => supabase.rpc("record_invoice_manually", { p_invoice_id: parsed.data.invoiceId, p_amount_paid_cents: cents }));
}

/** "Send to QuickBooks": queues the invoice and starts the worker. A second click queues nothing new. */
export async function sendInvoiceToQuickBooks(input: unknown): Promise<ActionResult> {
  const parsed = ids.safeParse(input);
  if (!parsed.success) return fail("invalid", "Unknown invoice");
  const result = await run(parsed.data.jobId, (supabase) => supabase.rpc("queue_invoice_sync", { p_invoice_id: parsed.data.invoiceId }));
  if (result.ok) after(() => processOutbox());
  return result;
}
