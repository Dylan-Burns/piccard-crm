import "server-only";
import { randomUUID } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { BUCKET } from "@/features/files/categories";
import { loadEstimateDocumentData, type EstimateDocumentData } from "@/features/estimates/pdf/data";
import { EstimateDocument } from "@/features/estimates/pdf/EstimateDocument";
import { appUrl } from "@/lib/env";
import { sendEmail, type Sender } from "@/lib/integrations/resend";
import { formatPhone } from "@/lib/phone";
import { fail, ok, type ActionResult } from "@/lib/result";
import { unwrapRpc, type RpcResult } from "@/lib/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export type SendResult = { publicUrl: string; email: "sent" | "already_sent" | "failed"; to: string };

export const publicEstimateUrl = (token: string) => `${appUrl()}/e/${token}`;

/** Emails the customer the link. `suffix` makes a deliberate resend a new logical email. */
async function emailEstimate(data: EstimateDocumentData, to: string, estimateId: string, opportunityId: string, token: string, sentAt: string, suffix = "", send?: Sender) {
  const revised = /-v\d+$/.test(data.estimate.label);
  return sendEmail(
    {
      dedupeKey: `estimate:${estimateId}:${data.estimate.label}:${sentAt}${suffix}`,
      template: "estimate",
      to,
      subject: `${revised ? "Your revised estimate" : "Your estimate"} from ${data.company.name}`,
      props: {
        customerName: data.customer.name.split(" ")[0] ?? data.customer.name,
        companyName: data.company.name,
        companyPhone: data.company.phone ? formatPhone(data.company.phone) : "",
        label: data.estimate.label,
        title: data.estimate.title,
        validUntil: data.estimate.validUntil,
        url: publicEstimateUrl(token),
        revised,
      },
      opportunityId,
    },
    send,
  );
}

/**
 * Sends a draft estimate (spec §7.4), in this order: check it can be sent → render the PDF and
 * store the snapshot → `mark_estimate_sent` (one transaction: status, file row, stage, tasks) →
 * email the link. An email failure leaves the estimate sent; the UI offers Resend and Copy link.
 * Takes the caller's client so RLS and the RPC's guard decide who may send.
 */
export async function sendEstimateFlow(
  supabase: SupabaseClient<Database>,
  estimateId: string,
  options: { logo?: EstimateDocumentData["company"]["logo"]; send?: Sender } = {},
): Promise<ActionResult<SendResult>> {
  const data = await loadEstimateDocumentData(supabase, estimateId, options.logo ?? null);
  if (!data) return fail("not_found", "Estimate not found");
  if (data.estimate.status !== "draft") return fail("not_draft", "Only a draft estimate can be sent");
  if (data.lines.length === 0 || data.estimate.totalCents <= 0) return fail("empty", "Add at least one line with a price before sending");
  const to = data.customer.email?.trim();
  if (!to) return fail("no_email", "The customer needs an email address before an estimate can be sent");

  const { data: row } = await supabase.from("estimates").select("opportunity_id, opportunity:opportunities!inner(customer_id)").eq("id", estimateId).maybeSingle();
  if (!row) return fail("not_found", "Estimate not found");

  // The customer always gets this stored snapshot, never a re-render.
  const pdf = await renderToBuffer(createElement(EstimateDocument, { data }) as never);
  const storage = createAdminClient().storage.from(BUCKET);
  const path = `${row.opportunity.customer_id}/${row.opportunity_id}/${randomUUID()}.pdf`;
  const upload = await storage.upload(path, pdf, { contentType: "application/pdf" });
  if (upload.error) return fail("storage_failed", "The estimate PDF could not be stored. Please try again.");

  const result = unwrapRpc<RpcResult & { public_token: string }>(await supabase.rpc("mark_estimate_sent", { p_estimate_id: estimateId, p_email: to, p_pdf_path: path }));
  if (!result.ok || result.data.already) {
    await storage.remove([path]); // not used: the send was refused, or another request sent it first
    if (!result.ok) return result;
  }

  const { data: sent } = await supabase.from("estimates").select("sent_at, public_token").eq("id", estimateId).single();
  const token = sent?.public_token ?? result.data.public_token;
  const email = await emailEstimate(data, to, estimateId, row.opportunity_id, token, sent?.sent_at ?? "", "", options.send);
  return ok({ publicUrl: publicEstimateUrl(token), email, to });
}

/** Sends the link again for an estimate that is out with the customer. */
export async function resendEstimateEmailFlow(supabase: SupabaseClient<Database>, estimateId: string, send?: Sender): Promise<ActionResult<SendResult>> {
  const { data: row } = await supabase.from("estimates").select("status, sent_at, sent_to_email, public_token, opportunity_id").eq("id", estimateId).maybeSingle();
  if (!row) return fail("not_found", "Estimate not found");
  if ((row.status !== "sent" && row.status !== "viewed") || !row.sent_to_email) return fail("not_sent", "Only an estimate that is out with the customer can be resent");
  const data = await loadEstimateDocumentData(supabase, estimateId);
  if (!data) return fail("not_found", "Estimate not found");
  const email = await emailEstimate(data, row.sent_to_email, estimateId, row.opportunity_id, row.public_token, row.sent_at ?? "", `:resend:${Date.now()}`, send);
  return ok({ publicUrl: publicEstimateUrl(row.public_token), email, to: row.sent_to_email });
}
