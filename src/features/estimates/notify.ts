import "server-only";
import { appUrl } from "@/lib/env";
import { sendEmail, type Sender } from "@/lib/integrations/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { estimateLabel } from "@/features/estimates/queries";

/**
 * Emails that follow a decision on an estimate. They run with the service client because the
 * public page has no signed-in user. Failures are logged in email_log and retried; they never
 * fail the action that triggered them (CLAUDE.md rule 17).
 */

/** To the deal owner (else the longest-standing admin): the customer approved or declined. */
export async function notifyEstimateDecision(estimateId: string, decision: "approved" | "declined", send?: Sender) {
  const db = createAdminClient();
  const { data: e } = await db
    .from("estimates")
    .select("id, estimate_number, version, decline_reason, opportunity:opportunities!inner(id, owner:profiles!opportunities_owner_id_fkey(email, is_active), customer:customers!inner(first_name, last_name))")
    .eq("id", estimateId)
    .maybeSingle();
  if (!e) return;
  let to = e.opportunity.owner?.is_active ? e.opportunity.owner.email : null;
  if (!to) {
    const { data: admin } = await db.from("profiles").select("email").eq("role", "admin").eq("is_active", true).order("created_at").limit(1).maybeSingle();
    to = admin?.email ?? null;
  }
  if (!to) return;
  const label = estimateLabel(e);
  const customerName = `${e.opportunity.customer.first_name} ${e.opportunity.customer.last_name}`.trim();
  await sendEmail(
    {
      dedupeKey: `est_decision:${e.id}`,
      template: "estimate_decision",
      to,
      subject: `${customerName} ${decision} estimate ${label}`,
      props: { customerName, label, decision, reason: decision === "declined" ? (e.decline_reason ?? "") : "", url: `${appUrl()}/opportunities/${e.opportunity.id}` },
      opportunityId: e.opportunity.id,
    },
    send,
  );
}

/** To every active admin: the deal is won and its job exists. One email per admin per deal. */
export async function notifyDealWon(opportunityId: string, send?: Sender) {
  const db = createAdminClient();
  const [{ data: deal }, { data: admins }] = await Promise.all([
    db
      .from("opportunities")
      .select("id, title, owner:profiles!opportunities_owner_id_fkey(full_name), customer:customers!inner(first_name, last_name), jobs(id, job_number)")
      .eq("id", opportunityId)
      .maybeSingle(),
    db.from("profiles").select("id, email").eq("role", "admin").eq("is_active", true),
  ]);
  if (!deal?.jobs || !admins) return;
  const customerName = `${deal.customer.first_name} ${deal.customer.last_name}`.trim();
  await Promise.all(
    admins.map((admin) =>
      sendEmail(
        {
          // Spec key is `won:{opportunity_id}`; the admin id keeps one row per recipient.
          dedupeKey: `won:${deal.id}:${admin.id}`,
          template: "deal_won",
          to: admin.email,
          subject: `Deal won: ${customerName}`,
          props: { customerName, dealTitle: deal.title, jobNumber: `J-${deal.jobs!.job_number}`, owner: deal.owner?.full_name ?? "", url: `${appUrl()}/jobs/${deal.jobs!.id}` },
          opportunityId: deal.id,
        },
        send,
      ),
    ),
  );
}
