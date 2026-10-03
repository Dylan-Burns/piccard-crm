import "server-only";
import { render } from "@react-email/components";
import { createElement } from "react";
import { Resend } from "resend";
import { EMAIL_TEMPLATES, type EmailTemplate } from "@/emails/templates";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

export type SendEmailInput = {
  /** Unique per logical email. Only a `sent` row with this key suppresses another send. */
  dedupeKey: string;
  template: EmailTemplate;
  to: string;
  subject: string;
  props: Record<string, unknown>;
  opportunityId?: string | null;
};

/** Delivers one rendered email. Replaceable in tests. */
export type Sender = (message: { to: string; subject: string; html: string; idempotencyKey: string }) => Promise<{ id: string | null }>;

const resendSender: Sender = async ({ to, subject, html, idempotencyKey }) => {
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Email is not configured (RESEND_API_KEY / EMAIL_FROM)");
  const { data, error } = await new Resend(env.RESEND_API_KEY).emails.send({ from: env.EMAIL_FROM, to, subject, html }, { idempotencyKey });
  if (error) throw new Error(error.message);
  return { id: data?.id ?? null };
};

/**
 * Sends a transactional email through the email_log outbox (spec §6.4):
 * log as pending → skip if already sent → attempt → mark sent or failed. Never throws.
 */
export async function sendEmail(input: SendEmailInput, send: Sender = resendSender): Promise<"sent" | "already_sent" | "failed"> {
  const db = createAdminClient();
  try {
    await db
      .from("email_log")
      .upsert(
        { dedupe_key: input.dedupeKey, template: input.template, to_email: input.to, subject: input.subject, props: input.props as Json, opportunity_id: input.opportunityId ?? null },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      );
    const { data: row } = await db.from("email_log").select("id, status, attempts, template, to_email, subject, props").eq("dedupe_key", input.dedupeKey).single();
    if (!row) return "failed";
    if (row.status === "sent") return "already_sent";
    return await attempt(row, send);
  } catch (error) {
    console.error("sendEmail failed", input.dedupeKey, error);
    return "failed";
  }
}

type LogRow = { id: string; attempts: number; template: string; to_email: string; subject: string; props: Json; status?: string };

async function attempt(row: LogRow, send: Sender): Promise<"sent" | "failed"> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  try {
    const component = EMAIL_TEMPLATES[row.template as EmailTemplate];
    if (!component) throw new Error(`Unknown email template: ${row.template}`);
    const html = await render(createElement(component as React.FC<Record<string, unknown>>, row.props as Record<string, unknown>));
    const { id } = await send({ to: row.to_email, subject: row.subject, html, idempotencyKey: `crm/${row.id}` });
    await db.from("email_log").update({ status: "sent", sent_at: now, resend_id: id, error: null, attempts: row.attempts + 1, last_attempt_at: now }).eq("id", row.id);
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("email_log").update({ status: "failed", error: message.slice(0, 500), attempts: row.attempts + 1, last_attempt_at: now }).eq("id", row.id);
    return "failed";
  }
}

/** Retries failed emails (under 5 attempts) and pending ones older than 10 minutes. */
export async function retryEmails(send: Sender = resendSender): Promise<{ retried: number; sent: number }> {
  const db = createAdminClient();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: rows } = await db
    .from("email_log")
    .select("id, status, attempts, template, to_email, subject, props, created_at")
    .in("status", ["failed", "pending"])
    .lt("attempts", 5)
    .order("created_at")
    .limit(50);
  let sent = 0;
  const due = (rows ?? []).filter((r) => r.status === "failed" || r.created_at < tenMinutesAgo);
  for (const row of due) if ((await attempt(row, send)) === "sent") sent += 1;
  return { retried: due.length, sent };
}
