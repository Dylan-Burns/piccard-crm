import "server-only";
import { decrypt, encrypt } from "@/lib/integrations/crypto";
import { gmail } from "@/lib/integrations/email/gmail";
import { microsoft } from "@/lib/integrations/email/microsoft";
import { MailboxError, type EmailProvider, type Fetch, type MailMessage, type MailProvider } from "@/lib/integrations/email/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

/**
 * Linked mailboxes: syncing customer email onto deals, and sending from a deal. This is the one
 * place besides the worker that reads the encrypted tokens, so it uses the service client
 * (CLAUDE.md rule 4). Callers are responsible for checking who is asking.
 */

export const PROVIDERS: Record<EmailProvider, MailProvider> = { google: gmail, microsoft };
type Db = ReturnType<typeof createAdminClient>;
type Account = { id: string; user_id: string; provider: EmailProvider; email_address: string; status: string; access_token_enc: string | null; refresh_token_enc: string | null; expires_at: string | null; synced_through: string | null };

const ACCOUNT_COLUMNS = "id, user_id, provider, email_address, status, access_token_enc, refresh_token_enc, expires_at, synced_through";
/** How far back the first sync of a mailbox looks. */
const FIRST_SYNC_DAYS = 30;
/** Re-check a little before the last sync, so mail that arrived mid-sync is not missed. */
const OVERLAP_MS = 10 * 60_000;

async function markError(db: Db, accountId: string, message: string) {
  await db.from("email_accounts").update({ status: "error", last_error: message.slice(0, 500) }).eq("id", accountId);
}

/** A usable access token, refreshed when fewer than five minutes remain. */
async function accessToken(db: Db, account: Account, fetchImpl: Fetch): Promise<string> {
  if (account.status !== "connected" || !account.access_token_enc || !account.refresh_token_enc) throw new MailboxError("The mailbox needs to be linked again");
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 5 * 60_000) return decrypt(account.access_token_enc);
  try {
    const refreshed = await PROVIDERS[account.provider].refresh(decrypt(account.refresh_token_enc), fetchImpl);
    await db
      .from("email_accounts")
      .update({
        access_token_enc: encrypt(refreshed.accessToken),
        // Microsoft issues a new refresh token each time; always keep the newest.
        ...(refreshed.refreshToken ? { refresh_token_enc: encrypt(refreshed.refreshToken) } : {}),
        expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
        last_error: null,
      })
      .eq("id", account.id);
    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof MailboxError) await markError(db, account.id, error.message);
    throw error;
  }
}

async function record(db: Db, account: Account, message: MailMessage, opportunityId?: string): Promise<boolean> {
  const { data } = await db.rpc("record_email_message", {
    p: {
      account_id: account.id,
      provider_message_id: message.providerMessageId,
      internet_message_id: message.internetMessageId,
      thread_id: message.threadId,
      direction: message.fromAddress === account.email_address.toLowerCase() ? "outbound" : "inbound",
      from_address: message.fromAddress,
      from_name: message.fromName,
      to_addresses: message.to,
      cc_addresses: message.cc,
      subject: message.subject,
      snippet: message.snippet,
      body_text: message.bodyText,
      has_attachments: message.hasAttachments,
      sent_at: message.sentAt,
      ...(opportunityId ? { opportunity_id: opportunityId } : {}),
    } as Json,
  });
  return Boolean((data as { stored?: boolean } | null)?.stored);
}

export type SyncResult = { checked: number; stored: number; error?: string };

/**
 * Pulls customer email from one mailbox. `customerEmail` limits it to one customer and looks
 * back a year (the mailbox owner pressing "Check for new email" on a deal); otherwise the
 * customers on deals the mailbox owner owns, since the last sync. Only messages involving one of
 * those addresses are requested or stored, and internal addresses are never among them.
 */
export async function syncAccount(accountId: string, options: { customerEmail?: string; fetchImpl?: Fetch } = {}, db: Db = createAdminClient()): Promise<SyncResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { data: account } = await db.from("email_accounts").select(ACCOUNT_COLUMNS).eq("id", accountId).maybeSingle();
  if (!account || account.status !== "connected") return { checked: 0, stored: 0, error: "The mailbox is not linked" };
  const startedAt = new Date();
  try {
    // The database decides which addresses this mailbox may be searched for: customers on deals
    // its owner owns (or the one customer asked for), never a colleague's or the company's own.
    const { data: allowed, error: addressError } = await db.rpc("mailbox_customer_addresses", {
      p_account_id: account.id,
      ...(options.customerEmail ? { p_customer_email: options.customerEmail } : {}),
    });
    if (addressError) throw new Error(addressError.message);
    const addresses = (allowed ?? []).filter((a) => a !== account.email_address.toLowerCase());
    const since = options.customerEmail
      ? new Date(Date.now() - 365 * 86_400_000)
      : account.synced_through
        ? new Date(new Date(account.synced_through).getTime() - OVERLAP_MS)
        : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
    if (addresses.length === 0) {
      await db.from("email_accounts").update({ last_synced_at: startedAt.toISOString(), last_error: null }).eq("id", account.id);
      return { checked: 0, stored: 0 };
    }

    const token = await accessToken(db, account as Account, fetchImpl);
    const messages = await PROVIDERS[account.provider].listSince(token, since, addresses, fetchImpl);
    let stored = 0;
    for (const message of messages) if (await record(db, account as Account, message)) stored += 1;
    await db
      .from("email_accounts")
      .update({ last_synced_at: startedAt.toISOString(), last_error: null, ...(options.customerEmail ? {} : { synced_through: startedAt.toISOString() }) })
      .eq("id", account.id);
    return { checked: messages.length, stored };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof MailboxError)) await db.from("email_accounts").update({ last_error: message.slice(0, 500) }).eq("id", account.id);
    return { checked: 0, stored: 0, error: message };
  }
}

/** Every linked mailbox, one after another (cron). Never throws. */
export async function syncAllAccounts(fetchImpl: Fetch = fetch): Promise<{ accounts: number; stored: number; errors: number }> {
  const db = createAdminClient();
  const { data: accounts } = await db.from("email_accounts").select("id").eq("status", "connected");
  let stored = 0;
  let errors = 0;
  for (const account of accounts ?? []) {
    const result = await syncAccount(account.id, { fetchImpl }, db).catch(() => ({ checked: 0, stored: 0, error: "failed" }));
    stored += result.stored;
    if (result.error) errors += 1;
  }
  return { accounts: accounts?.length ?? 0, stored, errors };
}

export type SendOutcome = { ok: true; to: string } | { ok: false; code: "not_linked" | "no_email" | "needs_relink" | "failed"; message: string };

/**
 * Sends an email to a deal's customer from the user's own mailbox and records it on the deal.
 * The caller has already checked that this user may see the deal.
 */
export async function sendFromMailbox(userId: string, input: { opportunityId: string; subject: string; body: string }, fetchImpl: Fetch = fetch, db: Db = createAdminClient()): Promise<SendOutcome> {
  const [{ data: account }, { data: deal }] = await Promise.all([
    db.from("email_accounts").select(ACCOUNT_COLUMNS).eq("user_id", userId).maybeSingle(),
    db.from("opportunities").select("id, customer:customers!inner(email)").eq("id", input.opportunityId).maybeSingle(),
  ]);
  if (!account || account.status === "disconnected") return { ok: false, code: "not_linked", message: "Link your email account first" };
  if (account.status !== "connected") return { ok: false, code: "needs_relink", message: "Your email account needs to be linked again" };
  const to = deal?.customer.email?.trim().toLowerCase();
  if (!to) return { ok: false, code: "no_email", message: "This customer has no email address" };
  try {
    const token = await accessToken(db, account as Account, fetchImpl);
    const sent = await PROVIDERS[account.provider].send(token, { from: account.email_address, to, subject: input.subject, body: input.body }, fetchImpl);
    await record(db, account as Account, sent, input.opportunityId);
    return { ok: true, to };
  } catch (error) {
    if (error instanceof MailboxError) return { ok: false, code: "needs_relink", message: error.message };
    return { ok: false, code: "failed", message: "The email could not be sent. Please try again." };
  }
}
