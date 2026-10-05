import "server-only";
import { serverEnv } from "@/lib/env";
import { htmlToText, isPlainEmail, MailboxError, oneLine, parseAddress, parseAddressList, type Fetch, type MailMessage, type MailProvider, type OutgoingMail, type Tokens } from "@/lib/integrations/email/types";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid email";
/** Addresses per search, so the query stays well inside Gmail's length limit. */
const CHUNK = 15;
const MAX_PER_SYNC = 200;

type Part = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string }; parts?: Part[] };
type GmailMessage = { id: string; threadId?: string; snippet?: string; internalDate?: string; payload?: Part & { headers?: { name: string; value: string }[] } };

function credentials() {
  const env = serverEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new MailboxError("Google sign-in is not set up");
  return { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET };
}

async function tokenRequest(params: Record<string, string>, fetchImpl: Fetch) {
  const response = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...credentials(), ...params }) }).catch(() => null);
  if (!response) throw new Error("Could not reach Google");
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string };
  if (!response.ok || !body.access_token) {
    if (response.status >= 500) throw new Error(`Google returned ${response.status}`);
    throw new MailboxError(body.error === "invalid_grant" ? "Google access was revoked or expired. Link the mailbox again." : `Google refused the sign-in (${body.error ?? response.status})`);
  }
  return body as { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string };
}

async function api<T>(fetchImpl: Fetch, token: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetchImpl(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  }).catch(() => null);
  if (!response) throw new Error("Could not reach Gmail");
  if (response.status === 401) throw new MailboxError("Google rejected the mailbox link. Link the mailbox again.");
  if (!response.ok) throw new Error(`Gmail returned ${response.status}`);
  return (await response.json()) as T;
}

const decode = (data: string | undefined) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

function findPart(part: Part | undefined, mimeType: string): Part | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}
const hasAttachment = (part: Part | undefined): boolean => Boolean(part && ((part.filename && part.body?.attachmentId) || (part.parts ?? []).some(hasAttachment)));

export function normalizeGmail(message: GmailMessage): MailMessage | null {
  const headers = new Map((message.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const from = parseAddress(headers.get("from") ?? "");
  const messageId = headers.get("message-id") ?? headers.get("message-id".toUpperCase());
  if (!from.address.includes("@") || !messageId) return null;
  const plain = findPart(message.payload, "text/plain");
  const html = plain ? null : findPart(message.payload, "text/html");
  return {
    providerMessageId: message.id,
    internetMessageId: messageId.trim(),
    threadId: message.threadId ?? null,
    fromAddress: from.address,
    fromName: from.name,
    to: parseAddressList(headers.get("to")),
    cc: parseAddressList(headers.get("cc")),
    subject: headers.get("subject") ?? "",
    snippet: message.snippet ?? "",
    bodyText: plain ? decode(plain.body!.data) : html ? htmlToText(decode(html.body!.data)) : (message.snippet ?? ""),
    hasAttachments: hasAttachment(message.payload),
    sentAt: new Date(Number(message.internalDate ?? Date.now())).toISOString(),
  };
}

/** A minimal RFC 5322 message. Non-ASCII subjects are encoded; line breaks cannot reach the headers. */
export function buildRawMessage(mail: OutgoingMail): string {
  const subject = oneLine(mail.subject);
  const encodedSubject = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const lines = [
    `From: ${oneLine(mail.from)}`,
    `To: ${oneLine(mail.to)}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(mail.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export const gmail: MailProvider = {
  name: "google",

  authUrl(redirectUri, state) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: credentials().client_id, redirect_uri: redirectUri, response_type: "code", scope: SCOPES, access_type: "offline", prompt: "consent", state }).toString();
    return url.toString();
  },

  async exchange(code, redirectUri, fetchImpl) {
    const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchImpl);
    // Which mailbox is this? Ask Gmail itself for the address of the mailbox these tokens open,
    // rather than trusting a claim: that is the address its mail is actually sent from.
    const email = ((await api<{ emailAddress?: string }>(fetchImpl, tokens.access_token, "/profile")).emailAddress ?? "").trim().toLowerCase();
    if (!isPlainEmail(email)) throw new MailboxError("Google did not say which mailbox this is");
    // The id token must agree and must mark the address verified.
    let claims: { email?: string; email_verified?: boolean } = {};
    try {
      claims = JSON.parse(Buffer.from(tokens.id_token!.split(".")[1]!, "base64url").toString("utf8"));
    } catch {
      // treated as unverified below
    }
    if (claims.email?.toLowerCase() !== email || claims.email_verified !== true) throw new MailboxError("Google could not confirm this mailbox's address");
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in ?? 3600, email };
  },

  async refresh(refreshToken, fetchImpl): Promise<Tokens> {
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in ?? 3600 };
  },

  async listSince(token, since, addresses, fetchImpl) {
    // Gmail is asked only for mail involving these addresses, so nothing else is ever fetched.
    // The addresses become part of the search text, so only plain ones are used: anything else
    // could add search operators and widen the search.
    const safe = addresses.filter(isPlainEmail);
    const ids = new Set<string>();
    for (let i = 0; i < safe.length && ids.size < MAX_PER_SYNC; i += CHUNK) {
      const terms = safe.slice(i, i + CHUNK).flatMap((a) => [`from:${a}`, `to:${a}`, `cc:${a}`]);
      const q = `after:${Math.floor(since.getTime() / 1000)} {${terms.join(" ")}}`;
      const page = await api<{ messages?: { id: string }[] }>(fetchImpl, token, `/messages?maxResults=100&q=${encodeURIComponent(q)}`);
      for (const m of page.messages ?? []) ids.add(m.id);
    }
    const messages: MailMessage[] = [];
    for (const id of [...ids].slice(0, MAX_PER_SYNC)) {
      const normalized = normalizeGmail(await api<GmailMessage>(fetchImpl, token, `/messages/${id}?format=full`));
      if (normalized) messages.push(normalized);
    }
    return messages;
  },

  async send(token, mail, fetchImpl) {
    const sent = await api<{ id: string; threadId?: string }>(fetchImpl, token, "/messages/send", { method: "POST", body: { raw: buildRawMessage(mail) } });
    // Gmail assigns the Message-ID; read it back so the stored copy matches what the sync would find.
    const stored = await api<GmailMessage>(fetchImpl, token, `/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`);
    const messageId = stored.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value ?? `<${sent.id}@mail.gmail.com>`;
    return {
      providerMessageId: sent.id,
      internetMessageId: messageId.trim(),
      threadId: sent.threadId ?? null,
      fromAddress: mail.from.toLowerCase(),
      fromName: null,
      to: [mail.to.toLowerCase()],
      cc: [],
      subject: oneLine(mail.subject),
      snippet: mail.body.slice(0, 200),
      bodyText: mail.body,
      hasAttachments: false,
      sentAt: new Date().toISOString(),
    };
  },
};
