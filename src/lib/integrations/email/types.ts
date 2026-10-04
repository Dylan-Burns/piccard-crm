import type { Database } from "@/types/database";

export type EmailProvider = Database["public"]["Enums"]["email_provider"];
export type Fetch = typeof fetch;

/** The mailbox link is broken (revoked, expired): tell the user to reconnect. */
export class MailboxError extends Error {}

export type Tokens = { accessToken: string; refreshToken?: string; expiresIn: number };

/** One email, in the same shape whichever provider it came from. Addresses are lower case. */
export type MailMessage = {
  providerMessageId: string;
  /** The Message-ID header: the same for every copy of one email. */
  internetMessageId: string;
  threadId: string | null;
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  bodyText: string;
  hasAttachments: boolean;
  sentAt: string;
};

export type OutgoingMail = { from: string; to: string; subject: string; body: string };

/** What a mail provider must do. Everything goes through an injected `fetch`, so tests can fake the provider. */
export interface MailProvider {
  readonly name: EmailProvider;
  /** Where to send the user to sign in. */
  authUrl(redirectUri: string, state: string): string;
  exchange(code: string, redirectUri: string, fetchImpl: Fetch): Promise<Tokens & { email: string }>;
  refresh(refreshToken: string, fetchImpl: Fetch): Promise<Tokens>;
  /** Messages since `since` that involve one of `addresses`. Other mail is not returned. */
  listSince(token: string, since: Date, addresses: string[], fetchImpl: Fetch): Promise<MailMessage[]>;
  send(token: string, mail: OutgoingMail, fetchImpl: Fetch): Promise<MailMessage>;
}

/** "Name <a@b.c>" or "a@b.c" → address and name. */
export function parseAddress(value: string): { address: string; name: string | null } {
  const match = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(value);
  if (match) return { address: match[2]!.trim().toLowerCase(), name: match[1]?.trim() || null };
  return { address: value.trim().toLowerCase(), name: null };
}

/** A header's address list → lower-case addresses. Commas inside quoted names are respected. */
export function parseAddressList(value: string | undefined | null): string[] {
  if (!value) return [];
  return (value.match(/(?:"[^"]*"|[^,])+/g) ?? [])
    .map((part) => parseAddress(part).address)
    .filter((address) => address.includes("@"));
}

/** Readable text from an HTML body, for messages that have no plain-text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Header values must be one line: a line break would let text become extra headers. */
export const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/**
 * A plain single address and nothing else. Addresses are placed into provider search queries and
 * message headers, so anything with spaces, quotes, brackets, commas, or operators is refused.
 */
export function isPlainEmail(value: string): boolean {
  return value.length <= 254 && /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value);
}
