import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeGoogleAdsLead, normalizeWebsiteLead, type LeadInput } from "@/features/leads/normalize";
import { WORK_TYPE_LABELS } from "@/lib/deal-status";
import { appUrl } from "@/lib/env";
import { sendEmail } from "@/lib/integrations/resend";
import { formatPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

type Db = SupabaseClient<Database>;
export type LeadChannel = "website" | "google_ads";

const RATE_LIMIT_PER_MINUTE = 10;

/** Constant-time comparison, so the secret cannot be guessed from response timing. */
export function secretsMatch(given: string | null | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ReceiveResult =
  | { status: 200; body: { ok: true; duplicate?: boolean }; submissionId: string | null }
  | { status: 400 | 429 | 503; body: { ok: false; error: string }; submissionId: null };

/**
 * Steps 2–5 of the durability rule (spec §6.5): rate limit, parse, STORE THE RAW PAYLOAD, answer.
 * Returns 503 when the payload could not be stored, so the sender retries and no lead is lost.
 * Authentication (step 1) is done by the route, which knows where its secret arrives.
 */
export async function receiveLead(channel: LeadChannel, rawBody: string, ip: string | null, db: Db = createAdminClient()): Promise<ReceiveResult> {
  if (ip) {
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count, error } = await db.from("lead_submissions").select("id", { count: "exact", head: true }).eq("source_ip", ip).gte("received_at", since);
    if (error) return { status: 503, body: { ok: false, error: "Temporarily unavailable" }, submissionId: null };
    if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) return { status: 429, body: { ok: false, error: "Too many requests" }, submissionId: null };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch {
    return { status: 400, body: { ok: false, error: "Body must be a JSON object" }, submissionId: null };
  }

  // The delivery id: the sender's own id when it has one, otherwise a hash of the raw body and the
  // UTC date (computed before any interpretation, so it cannot fail). Absorbs double submits.
  const given = channel === "google_ads" ? payload.lead_id : payload.submission_id;
  const externalId =
    typeof given === "string" && given.trim()
      ? given.trim().slice(0, 200)
      : createHash("sha256").update(rawBody).update(new Date().toISOString().slice(0, 10)).digest("hex");

  const { data, error } = await db
    .from("lead_submissions")
    .insert({ channel, external_id: externalId, payload: payload as Json, source_ip: ip, status: "received" })
    .select("id")
    .single();
  if (error?.code === "23505") return { status: 200, body: { ok: true, duplicate: true }, submissionId: null };
  if (error || !data) return { status: 503, body: { ok: false, error: "Temporarily unavailable" }, submissionId: null };
  return { status: 200, body: { ok: true }, submissionId: data.id };
}

type ProcessResult = { ok: boolean; status?: string; opportunity_id?: string; customer_id?: string; owner_id?: string | null; already?: boolean; message?: string };

/**
 * Step 6: normalize the stored payload, create or merge the lead, then notify. Safe to call again:
 * a submission that is already processed is left alone, and emails are deduped by key.
 */
export async function processSubmission(submissionId: string, db: Db = createAdminClient()): Promise<string> {
  const { data: submission } = await db.from("lead_submissions").select("id, channel, payload, status, attempts").eq("id", submissionId).maybeSingle();
  if (!submission) return "not_found";
  if (submission.status !== "received" && submission.status !== "error") return submission.status;

  const payload = submission.payload as Record<string, unknown>;
  const normalized = submission.channel === "google_ads" ? normalizeGoogleAdsLead(payload) : normalizeWebsiteLead(payload);
  if (!normalized.ok) {
    await db.from("lead_submissions").update({ status: "rejected", error: normalized.reason, processed_at: new Date().toISOString(), attempts: submission.attempts + 1 }).eq("id", submissionId);
    return "rejected";
  }

  const { data, error } = await db.rpc("process_lead_submission", { p_submission_id: submissionId, p_lead: normalized.lead as unknown as Json });
  if (error) {
    await db.from("lead_submissions").update({ status: "error", error: error.message.slice(0, 500), attempts: submission.attempts + 1 }).eq("id", submissionId);
    return "error";
  }
  const result = data as ProcessResult;
  if (!result.ok) return result.status ?? "error";
  if (!result.already && result.opportunity_id) await notifyLead(db, submissionId, result, normalized.lead);
  return result.status ?? "created";
}

/** Emails the person responsible: "new lead" for a new deal, "contacted us again" for a merge. */
export async function notifyLead(db: Db, key: string, result: ProcessResult, lead: Pick<LeadInput, "first_name" | "last_name" | "phone" | "work_type" | "address_line1" | "source_name" | "message">) {
  if (!result.opportunity_id) return;
  const { data: deal } = await db.from("opportunities").select("title, owner_id").eq("id", result.opportunity_id).maybeSingle();
  // The deal's owner, else the longest-standing active admin (same rule as automatic tasks).
  const { data: recipient } = deal?.owner_id
    ? await db.from("profiles").select("email").eq("id", deal.owner_id).eq("is_active", true).maybeSingle()
    : await db.from("profiles").select("email").eq("role", "admin").eq("is_active", true).order("created_at").limit(1).maybeSingle();
  if (!recipient?.email) return;

  const name = `${lead.first_name} ${lead.last_name}`.trim();
  const url = `${appUrl()}/opportunities/${result.opportunity_id}`;
  if (result.status === "merged_duplicate") {
    await sendEmail({
      dedupeKey: `dup:${key}`,
      template: "duplicate_inquiry",
      to: recipient.email,
      subject: `${name} contacted us again`,
      props: { name, dealTitle: deal?.title ?? "", message: lead.message, url },
      opportunityId: result.opportunity_id,
    });
  } else {
    await sendEmail({
      dedupeKey: `new_lead:${result.opportunity_id}`,
      template: "new_lead",
      to: recipient.email,
      subject: `New lead: ${name}`,
      props: {
        name,
        phone: formatPhone(lead.phone),
        workType: lead.work_type ? (WORK_TYPE_LABELS[lead.work_type as keyof typeof WORK_TYPE_LABELS] ?? "") : "",
        address: lead.address_line1,
        source: lead.source_name,
        message: lead.message,
        url,
      },
      opportunityId: result.opportunity_id,
    });
  }
}

/** Re-runs submissions stuck in `received` (older than 2 minutes) or in `error` with attempts left. */
export async function retryLeadSubmissions(db: Db = createAdminClient()): Promise<{ retried: number }> {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: rows } = await db
    .from("lead_submissions")
    .select("id, status, received_at")
    .in("status", ["received", "error"])
    .lt("attempts", 5)
    .order("received_at")
    .limit(50);
  const due = (rows ?? []).filter((r) => r.status === "error" || r.received_at < twoMinutesAgo);
  for (const row of due) await processSubmission(row.id, db);
  return { retried: due.length };
}

/** Client IP as seen by the platform's proxy. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip");
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}
