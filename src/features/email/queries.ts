import "server-only";
import { formatDateTime } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's linked mailbox (status only; tokens are not readable). Null when none. */
export async function getMyMailbox(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("email_accounts").select("provider, email_address, status, last_synced_at, last_error").eq("user_id", userId).maybeSingle();
  return data;
}
export type Mailbox = NonNullable<Awaited<ReturnType<typeof getMyMailbox>>>;

export type DealEmail = { id: string; direction: "inbound" | "outbound"; from: string; to: string; subject: string; snippet: string; body: string; hasAttachments: boolean; when: string };

/** Email on a deal, newest first. Staff only (RLS). */
export async function listDealEmails(opportunityId: string, timeZone: string): Promise<DealEmail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_messages")
    .select("id, direction, from_address, from_name, to_addresses, subject, snippet, body_text, has_attachments, sent_at")
    .eq("opportunity_id", opportunityId)
    .order("sent_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data.map((m) => ({
    id: m.id,
    direction: m.direction,
    from: m.from_name ? `${m.from_name} <${m.from_address}>` : String(m.from_address),
    to: m.to_addresses.join(", "),
    subject: m.subject || "(no subject)",
    snippet: m.snippet,
    body: m.body_text,
    hasAttachments: m.has_attachments,
    when: formatDateTime(m.sent_at, timeZone),
  }));
}
