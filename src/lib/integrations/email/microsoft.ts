import "server-only";
import { serverEnv } from "@/lib/env";
import { htmlToText, isPlainEmail, MailboxError, oneLine, type Fetch, type MailMessage, type MailProvider, type Tokens } from "@/lib/integrations/email/types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = "offline_access openid email User.Read Mail.Read Mail.Send";
const MAX_PAGES = 5;

type Recipient = { emailAddress?: { address?: string; name?: string } };
type GraphMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  from?: Recipient;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  sentDateTime?: string;
  receivedDateTime?: string;
  isDraft?: boolean;
};

function config() {
  const env = serverEnv();
  // The tenant id is required: sign-in is limited to the company's own Microsoft organisation.
  // Accepting any organisation would let someone with their own tenant present whatever address they like.
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.MICROSOFT_TENANT_ID) throw new MailboxError("Microsoft sign-in is not set up");
  if (!/^[0-9a-f-]{36}$/i.test(env.MICROSOFT_TENANT_ID)) throw new MailboxError("MICROSOFT_TENANT_ID must be the organisation's tenant id (a GUID)");
  return { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, authority: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0` };
}

async function tokenRequest(params: Record<string, string>, fetchImpl: Fetch) {
  const { clientId, clientSecret, authority } = config();
  const response = await fetchImpl(`${authority}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: SCOPES, ...params }),
  }).catch(() => null);
  if (!response) throw new Error("Could not reach Microsoft");
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !body.access_token) {
    if (response.status >= 500) throw new Error(`Microsoft returned ${response.status}`);
    throw new MailboxError(body.error === "invalid_grant" ? "Microsoft access was revoked or expired. Link the mailbox again." : `Microsoft refused the sign-in (${body.error ?? response.status})`);
  }
  return body as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function graph<T>(fetchImpl: Fetch, token: string, url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetchImpl(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"', ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  }).catch(() => null);
  if (!response) throw new Error("Could not reach Microsoft");
  if (response.status === 401) throw new MailboxError("Microsoft rejected the mailbox link. Link the mailbox again.");
  if (!response.ok) throw new Error(`Microsoft returned ${response.status}`);
  return response.status === 202 || response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const address = (r: Recipient | undefined) => r?.emailAddress?.address?.trim().toLowerCase() ?? "";
const addresses = (list: Recipient[] | undefined) => (list ?? []).map(address).filter((a) => a.includes("@"));

export function normalizeGraph(message: GraphMessage): MailMessage | null {
  const from = address(message.from);
  if (!from.includes("@") || !message.internetMessageId) return null;
  const content = message.body?.content ?? "";
  return {
    providerMessageId: message.id,
    internetMessageId: message.internetMessageId.trim(),
    threadId: message.conversationId ?? null,
    fromAddress: from,
    fromName: message.from?.emailAddress?.name?.trim() || null,
    to: addresses(message.toRecipients),
    cc: addresses(message.ccRecipients),
    subject: message.subject ?? "",
    snippet: message.bodyPreview ?? "",
    bodyText: message.body?.contentType?.toLowerCase() === "html" ? htmlToText(content) : content,
    hasAttachments: Boolean(message.hasAttachments),
    sentAt: new Date(message.sentDateTime ?? message.receivedDateTime ?? Date.now()).toISOString(),
  };
}

export const microsoft: MailProvider = {
  name: "microsoft",

  authUrl(redirectUri, state) {
    const { clientId, authority } = config();
    const url = new URL(`${authority}/authorize`);
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", response_mode: "query", scope: SCOPES, prompt: "select_account", state }).toString();
    return url.toString();
  },

  async exchange(code, redirectUri, fetchImpl) {
    const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchImpl);
    // Which mailbox is this? Not the `mail` attribute: an administrator can set that to any text.
    // The primary entry in proxyAddresses ("SMTP:" in capitals) and the sign-in name are both
    // restricted to domains the organisation has verified.
    const me = await graph<{ userPrincipalName?: string; proxyAddresses?: string[] }>(fetchImpl, tokens.access_token, "/me?$select=userPrincipalName,proxyAddresses");
    const primary = (me.proxyAddresses ?? []).find((a) => a.startsWith("SMTP:"))?.slice(5);
    const email = (primary ?? me.userPrincipalName ?? "").trim().toLowerCase();
    if (!isPlainEmail(email)) throw new MailboxError("Microsoft did not say which mailbox this is");
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in ?? 3600, email };
  },

  async refresh(refreshToken, fetchImpl): Promise<Tokens> {
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in ?? 3600 };
  },

  async listSince(token, since, wanted, fetchImpl) {
    // Graph cannot filter by a list of correspondents, so list headers only (no bodies) since the
    // last sync, keep the ones involving a customer, and fetch the body for just those.
    const want = new Set(wanted);
    const select = "id,internetMessageId,conversationId,from,toRecipients,ccRecipients,subject,bodyPreview,hasAttachments,sentDateTime,receivedDateTime,isDraft";
    let url: string | undefined = `/me/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`)}&$select=${select}&$top=100&$orderby=${encodeURIComponent("receivedDateTime asc")}`;
    const matches: GraphMessage[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const result: { value?: GraphMessage[]; "@odata.nextLink"?: string } = await graph(fetchImpl, token, url);
      for (const m of result.value ?? []) {
        if (m.isDraft) continue;
        if ([address(m.from), ...addresses(m.toRecipients), ...addresses(m.ccRecipients)].some((a) => want.has(a))) matches.push(m);
      }
      url = result["@odata.nextLink"];
    }
    const messages: MailMessage[] = [];
    for (const m of matches) {
      const full = await graph<GraphMessage>(fetchImpl, token, `/me/messages/${encodeURIComponent(m.id)}?$select=${select},body`);
      const normalized = normalizeGraph(full);
      if (normalized) messages.push(normalized);
    }
    return messages;
  },

  async send(token, mail, fetchImpl) {
    // Create a draft first: that returns the ids the sync will later see. Then send it.
    const draft = await graph<GraphMessage>(fetchImpl, token, "/me/messages", {
      method: "POST",
      body: { subject: oneLine(mail.subject), body: { contentType: "Text", content: mail.body }, toRecipients: [{ emailAddress: { address: oneLine(mail.to) } }] },
    });
    await graph<void>(fetchImpl, token, `/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" });
    return {
      providerMessageId: draft.id,
      internetMessageId: (draft.internetMessageId ?? `<${draft.id}@outlook>`).trim(),
      threadId: draft.conversationId ?? null,
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
