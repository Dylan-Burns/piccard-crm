import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.INTEGRATION_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.MICROSOFT_CLIENT_ID ??= "test-ms-client";
process.env.MICROSOFT_CLIENT_SECRET ??= "test-ms-secret";

import { decrypt, encrypt } from "@/lib/integrations/crypto";
import { sendFromMailbox, syncAccount } from "@/lib/integrations/email/mailbox";
import type { Fetch } from "@/lib/integrations/email/types";
import type { Json } from "@/types/database";
import { PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";

// Linked mailboxes with Gmail and Microsoft Graph replaced by a fake `fetch`.
const service = serviceClient();
let admin: Client, sales: Client, field: Client;
let adminId: string, salesId: string;
const stamp = Date.now();
const SALES_MAILBOX = `sam.${stamp}@roofco.example`;
const ADMIN_MAILBOX = `ada.${stamp}@roofco.example`;
const CUSTOMER = `pat.${stamp}@customer.example`;
const STRANGER = `someone.${stamp}@elsewhere.example`;
let dealId: string, customerId: string;
const customers: string[] = [];

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
function fake(respond: (call: Call) => { status?: number; body?: unknown }): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    const body = typeof raw === "string" ? JSON.parse(raw) : raw instanceof URLSearchParams ? Object.fromEntries(raw) : null;
    const call: Call = { method: init?.method ?? "GET", url: String(input), body };
    calls.push(call);
    const { status = 200, body: responseBody } = respond(call);
    return new Response(status === 202 || status === 204 ? null : JSON.stringify(responseBody ?? {}), { status, headers: { "Content-Type": "application/json" } });
  }) as Fetch;
}
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

const link = (client: Client, provider: "google" | "microsoft", email: string, expiresInMs = 3_600_000) =>
  client.rpc("save_email_account", { p_provider: provider, p_email: email, p_access_token_enc: encrypt("access-1"), p_refresh_token_enc: encrypt("refresh-1"), p_expires_at: new Date(Date.now() + expiresInMs).toISOString() });
const accountOf = async (userId: string) => (await service.from("email_accounts").select("*").eq("user_id", userId).single()).data!;
const messages = async () => (await service.from("email_messages").select("*").eq("customer_id", customerId).order("sent_at")).data!;
const emailActivities = async () => (await service.from("activities").select("summary, actor_id, metadata").eq("opportunity_id", dealId).eq("type", "email").order("occurred_at")).data!;

function gmailMessage(id: string, headers: Record<string, string>, part: { mimeType: string; text: string }, extra: Record<string, unknown> = {}) {
  return { id, threadId: "thread-1", snippet: part.text.replace(/<[^>]+>/g, "").slice(0, 80), internalDate: String(Date.parse("2026-09-20T15:00:00Z")), payload: { mimeType: part.mimeType, headers: Object.entries(headers).map(([name, value]) => ({ name, value })), body: { data: b64(part.text) }, ...extra } };
}

beforeAll(async () => {
  ({ client: admin, userId: adminId } = await signInAs("admin@test.local"));
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field } = await signInAs("field@test.local"));
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Pat", last_name: `Mail${stamp}`, phone: `564${String(stamp).slice(-7)}`, phone_e164: `+1618${String(stamp).slice(-7)}`, email: CUSTOMER, address_line1: "1 Inbox Way", postal_code: "62701", work_type: "roof_repair", owner_id: salesId } as Json,
  });
  ({ opportunity_id: dealId, customer_id: customerId } = data as { opportunity_id: string; customer_id: string });
  customers.push(customerId);
});

beforeEach(() => {
  calls = [];
});

afterAll(async () => {
  await service.from("email_accounts").delete().in("user_id", [adminId, salesId]);
  for (const id of customers) {
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
});

describe("linking a mailbox", () => {
  it("a staff user links their own mailbox; tokens are never readable through the API", async () => {
    expect((await link(sales, "google", `  ${SALES_MAILBOX.toUpperCase()} `)).data).toEqual({ ok: true });
    const stored = await accountOf(salesId);
    expect(stored).toMatchObject({ provider: "google", email_address: SALES_MAILBOX, status: "connected" });
    expect(stored.access_token_enc).not.toContain("access-1");
    expect(decrypt(stored.refresh_token_enc!)).toBe("refresh-1");

    // Own status: yes. Tokens: no, for anyone.
    expect((await sales.from("email_accounts").select("email_address, status, provider")).data).toEqual([{ email_address: SALES_MAILBOX, status: "connected", provider: "google" }]);
    for (const column of ["access_token_enc", "refresh_token_enc", "*"]) {
      expect((await sales.from("email_accounts").select(column)).error?.code, column).toBe(PERMISSION_DENIED);
      expect((await admin.from("email_accounts").select(column)).error?.code, column).toBe(PERMISSION_DENIED);
    }
    // No direct writes
    expect((await sales.from("email_accounts").update({ status: "connected" }).eq("user_id", salesId)).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.from("email_accounts").insert({ user_id: adminId, provider: "google", email_address: "x@y.z" })).error?.code).toBe(PERMISSION_DENIED);

    // Another user's mailbox: admins see its status, other staff and field users do not
    expect((await link(admin, "microsoft", ADMIN_MAILBOX)).data).toEqual({ ok: true });
    expect((await admin.from("email_accounts").select("email_address")).data!.map((r) => r.email_address).sort()).toEqual([ADMIN_MAILBOX, SALES_MAILBOX].sort());
    expect((await sales.from("email_accounts").select("email_address")).data).toEqual([{ email_address: SALES_MAILBOX }]);
    expect((await field.from("email_accounts").select("email_address")).data ?? []).toEqual([]);
    expect((await field.rpc("save_email_account", { p_provider: "google", p_email: "f@x.y", p_access_token_enc: "a", p_refresh_token_enc: "b", p_expires_at: new Date().toISOString() })).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.rpc("save_email_account", { p_provider: "google", p_email: "not-an-email", p_access_token_enc: "a", p_refresh_token_enc: "b", p_expires_at: new Date().toISOString() })).data).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("Gmail sync", () => {
  const inbound = gmailMessage("g-in", { From: `"Pat Mail" <${CUSTOMER}>`, To: SALES_MAILBOX, Subject: "Re: roof leak", "Message-ID": `<in-${stamp}@customer.example>` }, { mimeType: "text/plain", text: "Thursday works.\nPrice of $4,200 is fine." });
  const outbound = gmailMessage("g-out", { From: SALES_MAILBOX, To: `Pat <${CUSTOMER}>`, Cc: `"Office, Main" <office@roofco.example>`, Subject: "Roof leak", "Message-ID": `<out-${stamp}@roofco.example>` }, { mimeType: "text/html", text: "<p>Hi Pat,</p><p>Can we come <b>Thursday</b>?</p>" });
  const stranger = gmailMessage("g-x", { From: STRANGER, To: SALES_MAILBOX, Subject: "Unrelated", "Message-ID": `<x-${stamp}@elsewhere.example>` }, { mimeType: "text/plain", text: "Private." });
  const gmailFake = (ids: string[]) =>
    fake((call) => {
      if (call.url.includes("/messages?")) return { body: { messages: ids.map((id) => ({ id })) } };
      const id = /\/messages\/([^?]+)/.exec(call.url)?.[1];
      return { body: { "g-in": inbound, "g-out": outbound, "g-x": stranger }[id!] };
    });

  it("asks Gmail only for mail involving customers, stores both directions, and adds one timeline entry each", async () => {
    const account = await accountOf(salesId);
    expect(await syncAccount(account.id, { fetchImpl: gmailFake(["g-in", "g-out"]) })).toEqual({ checked: 2, stored: 2 });

    // Customer addresses are searched in chunks; look across all of the searches.
    const search = calls.filter((c) => c.url.includes("/messages?")).map((c) => decodeURIComponent(c.url)).join("\n");
    expect(search).toMatch(/q=after:\d+ \{/);
    expect(search).toContain(`from:${CUSTOMER}`);
    expect(search).toContain(`to:${CUSTOMER}`);
    expect(search).not.toContain(SALES_MAILBOX); // the mailbox's own address is not a customer

    const stored = await messages();
    expect(stored.map((m) => [m.direction, m.subject])).toEqual(expect.arrayContaining([["inbound", "Re: roof leak"], ["outbound", "Roof leak"]]));
    const incoming = stored.find((m) => m.direction === "inbound")!;
    expect(incoming).toMatchObject({ from_address: CUSTOMER, from_name: "Pat Mail", to_addresses: [SALES_MAILBOX], opportunity_id: dealId, account_id: account.id, provider: "google", body_text: "Thursday works.\nPrice of $4,200 is fine." });
    const outgoing = stored.find((m) => m.direction === "outbound")!;
    expect(outgoing.body_text).toBe("Hi Pat,\nCan we come Thursday?"); // HTML reduced to text
    expect(outgoing.cc_addresses).toEqual(["office@roofco.example"]);

    const activities = await emailActivities();
    expect(activities.map((a) => a.summary)).toEqual(expect.arrayContaining(["Email received: Re: roof leak", "Sam Sales emailed: Roof leak"]));
    expect(activities).toHaveLength(2);
    expect((await accountOf(salesId)).synced_through).toBeTruthy();
  });

  it("syncing again stores nothing new, and mail that does not involve a customer is never stored", async () => {
    const account = await accountOf(salesId);
    expect(await syncAccount(account.id, { fetchImpl: gmailFake(["g-in", "g-out", "g-x"]) })).toEqual({ checked: 3, stored: 0 });
    expect(await messages()).toHaveLength(2);
    expect((await service.from("email_messages").select("id").eq("from_address", STRANGER)).data).toEqual([]);
    expect(await emailActivities()).toHaveLength(2);
  });

  it("all staff can read a deal's email; field users cannot; nobody writes it directly", async () => {
    expect((await admin.from("email_messages").select("subject").eq("opportunity_id", dealId)).data).toHaveLength(2);
    expect((await sales.from("email_messages").select("subject").eq("opportunity_id", dealId)).data).toHaveLength(2);
    expect((await field.from("email_messages").select("subject").eq("opportunity_id", dealId)).data ?? []).toEqual([]);
    const row = { internet_message_id: "<forged>", provider: "google" as const, provider_message_id: "f", direction: "inbound" as const, from_address: "a@b.c", sent_at: new Date().toISOString(), customer_id: customerId };
    expect((await sales.from("email_messages").insert(row)).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.from("email_messages").delete().eq("opportunity_id", dealId)).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.rpc("record_email_message", { p: {} as Json })).error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("sending from a deal", () => {
  it("sends through Gmail from the rep's address and records it on the deal; a line break cannot add headers", async () => {
    const google = fake((call) => (call.method === "POST" ? { body: { id: "g-sent", threadId: "thread-9" } } : { body: { id: "g-sent", payload: { headers: [{ name: "Message-Id", value: `<sent-${stamp}@mail.gmail.com>` }] } } }));
    const result = await sendFromMailbox(salesId, { opportunityId: dealId, subject: "Estimate ready\r\nBcc: thief@evil.example", body: "Hi Pat,\n\nYour estimate is ready.\n\nSam" }, google);
    expect(result).toEqual({ ok: true, to: CUSTOMER });

    const raw = Buffer.from((calls[0]!.body as { raw: string }).raw, "base64url").toString("utf8");
    const [head, body] = raw.split("\r\n\r\n");
    expect(head).toContain(`From: ${SALES_MAILBOX}`);
    expect(head).toContain(`To: ${CUSTOMER}`);
    expect(head).toContain("Subject: Estimate ready Bcc: thief@evil.example"); // one header line
    expect(head!.split("\r\n").filter((line) => /^bcc:/i.test(line))).toEqual([]);
    expect(Buffer.from(body!.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Hi Pat,\n\nYour estimate is ready.\n\nSam");

    const stored = (await messages()).find((m) => m.provider_message_id === "g-sent")!;
    expect(stored).toMatchObject({ direction: "outbound", from_address: SALES_MAILBOX, to_addresses: [CUSTOMER], opportunity_id: dealId, internet_message_id: `<sent-${stamp}@mail.gmail.com>`, thread_id: "thread-9" });
    const activity = (await emailActivities()).at(-1)!;
    expect(activity.summary).toBe("Sam Sales emailed: Estimate ready Bcc: thief@evil.example");
    expect(activity.actor_id).toBe(salesId);

    // The sync later finds the same message in Sent: it is not stored twice
    const sentCopy = gmailMessage("g-sent", { From: SALES_MAILBOX, To: CUSTOMER, Subject: "Estimate ready", "Message-ID": `<sent-${stamp}@mail.gmail.com>` }, { mimeType: "text/plain", text: "Hi Pat" });
    const account = await accountOf(salesId);
    expect(await syncAccount(account.id, { fetchImpl: fake((c) => (c.url.includes("/messages?") ? { body: { messages: [{ id: "g-sent" }] } } : { body: sentCopy })) })).toMatchObject({ stored: 0 });
  });

  it("explains what is missing: no linked mailbox, no customer email, or a revoked link", async () => {
    const { userId: field2Id } = await signInAs("field2@test.local");
    expect(await sendFromMailbox(field2Id, { opportunityId: dealId, subject: "x", body: "y" }, fake(() => ({})))).toMatchObject({ ok: false, code: "not_linked" });

    const { data } = await service.rpc("create_lead", { p: { channel: "manual", first_name: "No", last_name: `Email${stamp}`, phone: `565${String(stamp).slice(-7)}`, phone_e164: `+1217${String(stamp).slice(-7)}`, owner_id: salesId } as Json });
    const noEmail = data as { opportunity_id: string; customer_id: string };
    customers.push(noEmail.customer_id);
    expect(await sendFromMailbox(salesId, { opportunityId: noEmail.opportunity_id, subject: "x", body: "y" }, fake(() => ({})))).toMatchObject({ ok: false, code: "no_email" });

    expect(await sendFromMailbox(salesId, { opportunityId: dealId, subject: "x", body: "y" }, fake(() => ({ status: 401 })))).toMatchObject({ ok: false, code: "needs_relink" });
    expect(await sendFromMailbox(salesId, { opportunityId: dealId, subject: "x", body: "y" }, fake(() => ({ status: 500 })))).toMatchObject({ ok: false, code: "failed" });
    expect((await messages()).filter((m) => m.subject === "x")).toEqual([]); // nothing recorded for a failed send
  });
});

describe("Microsoft 365", () => {
  const graphMessage = (id: string, from: string, to: string, subject: string, extra: Record<string, unknown> = {}) => ({
    id, internetMessageId: `<${id}-${stamp}@outlook.example>`, conversationId: "conv-1", from: { emailAddress: { address: from, name: "Display Name" } }, toRecipients: [{ emailAddress: { address: to } }], ccRecipients: [], subject, bodyPreview: "Preview", hasAttachments: id === "m-in", sentDateTime: "2026-09-21T15:00:00Z", ...extra,
  });

  it("refreshes an expiring token (keeping Microsoft's new refresh token), reads headers, and fetches bodies only for customer mail", async () => {
    await link(admin, "microsoft", ADMIN_MAILBOX, 60_000); // about to expire
    const account = await accountOf(adminId);
    const graph = fake((call) => {
      if (call.url.includes("/oauth2/v2.0/token")) return { body: { access_token: "ms-access-2", refresh_token: "ms-refresh-2", expires_in: 3600 } };
      if (call.url.includes("/me/messages?")) {
        return { body: { value: [graphMessage("m-in", CUSTOMER.toUpperCase(), ADMIN_MAILBOX, "Question about warranty"), graphMessage("m-x", STRANGER, ADMIN_MAILBOX, "Private matter"), graphMessage("m-draft", ADMIN_MAILBOX, CUSTOMER, "Draft", { isDraft: true })] } };
      }
      return { body: graphMessage("m-in", CUSTOMER, ADMIN_MAILBOX, "Question about warranty", { body: { contentType: "text", content: "How long is the warranty?" } }) };
    });
    // The admin does not own this deal, so this is the explicit "Check for new email" path.
    expect(await syncAccount(account.id, { customerEmail: CUSTOMER, fetchImpl: graph })).toEqual({ checked: 1, stored: 1 });

    expect(calls[0]!.url).toContain("login.microsoftonline.com/organizations/oauth2/v2.0/token");
    expect(calls[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });
    const after = await accountOf(adminId);
    expect(decrypt(after.access_token_enc!)).toBe("ms-access-2");
    expect(decrypt(after.refresh_token_enc!)).toBe("ms-refresh-2");

    const list = calls.find((c) => c.url.includes("/me/messages?"))!;
    expect(decodeURIComponent(list.url)).not.toMatch(/\$select=[^&]*\bbody\b(?!Preview)/); // the listing asks for headers only
    const bodyFetches = calls.filter((c) => /\/me\/messages\/[^/?]+\?/.test(c.url)).map((c) => /\/me\/messages\/([^?]+)/.exec(c.url)![1]);
    expect(bodyFetches).toEqual(["m-in"]); // never the stranger's message or the draft

    const stored = (await messages()).find((m) => m.provider_message_id === "m-in")!;
    expect(stored).toMatchObject({ provider: "microsoft", direction: "inbound", from_address: CUSTOMER, subject: "Question about warranty", body_text: "How long is the warranty?", has_attachments: true, account_id: account.id });
    expect((await service.from("email_messages").select("id").eq("provider_message_id", "m-x")).data).toEqual([]);
  });

  it("sends by creating a draft and sending it, and records the message", async () => {
    const graph = fake((call) => (call.url.endsWith("/send") ? { status: 202 } : { status: 201, body: { id: "m-sent", internetMessageId: `<m-sent-${stamp}@outlook.example>`, conversationId: "conv-2" } }));
    expect(await sendFromMailbox(adminId, { opportunityId: dealId, subject: "Warranty", body: "Five years." }, graph)).toEqual({ ok: true, to: CUSTOMER });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v1.0/me/messages", "POST /v1.0/me/messages/m-sent/send"]);
    expect(calls[0]!.body).toMatchObject({ subject: "Warranty", body: { contentType: "Text", content: "Five years." }, toRecipients: [{ emailAddress: { address: CUSTOMER } }] });
    expect((await messages()).find((m) => m.provider_message_id === "m-sent")).toMatchObject({ direction: "outbound", from_address: ADMIN_MAILBOX, provider: "microsoft" });
  });

  it("the same email seen from a second mailbox is stored once", async () => {
    const before = (await messages()).length;
    const copy = gmailMessage("g-copy", { From: CUSTOMER, To: `${ADMIN_MAILBOX}, ${SALES_MAILBOX}`, Subject: "Question about warranty", "Message-ID": `<m-in-${stamp}@outlook.example>` }, { mimeType: "text/plain", text: "How long is the warranty?" });
    const account = await accountOf(salesId);
    expect(await syncAccount(account.id, { fetchImpl: fake((c) => (c.url.includes("/messages?") ? { body: { messages: [{ id: "g-copy" }] } } : { body: copy })) })).toMatchObject({ checked: 1, stored: 0 });
    expect(await messages()).toHaveLength(before);
  });
});

describe("whose mail can be pulled", () => {
  it("a mailbox is searched in the background only for customers on deals its owner owns", async () => {
    const account = await accountOf(adminId); // the admin does not own this customer's deal
    expect((await service.rpc("mailbox_customer_addresses", { p_account_id: account.id })).data).not.toContain(CUSTOMER);
    expect((await service.rpc("mailbox_customer_addresses", { p_account_id: (await accountOf(salesId)).id })).data).toContain(CUSTOMER);

    // The admin's mailbox holds mail from that customer, but a background sync leaves it alone
    const header = { id: "m-other", internetMessageId: `<m-other-${stamp}@outlook.example>`, from: { emailAddress: { address: CUSTOMER } }, toRecipients: [{ emailAddress: { address: ADMIN_MAILBOX } }], subject: "For the admin only", sentDateTime: "2026-09-22T15:00:00Z" };
    const result = await syncAccount(account.id, { fetchImpl: fake((c) => (c.url.includes("/me/messages?") ? { body: { value: [header] } } : { body: header })) });
    expect(result).toMatchObject({ stored: 0 });
    expect(calls.filter((c) => /\/me\/messages\/[^/?]+\?/.test(c.url))).toEqual([]); // its body was never fetched
    expect((await service.from("email_messages").select("id").eq("provider_message_id", "m-other")).data).toEqual([]);
  });

  it("a colleague's address, a linked mailbox, or the company's own domain is never treated as a customer", async () => {
    // A staff user adds "customers" whose addresses are really colleagues' or internal ones.
    const internal = [ADMIN_MAILBOX, `payroll.${stamp}@roofco.example`, "admin@test.local"];
    for (const [index, email] of internal.entries()) {
      const { data } = await service.rpc("create_lead", { p: { channel: "manual", first_name: "Not", last_name: `Customer${stamp}${index}`, phone: `566${String(stamp).slice(-6)}${index}`, phone_e164: `+1630${String(stamp).slice(-6)}${index}`, email, owner_id: salesId } as Json });
      customers.push((data as { customer_id: string }).customer_id);
    }
    const account = await accountOf(salesId);
    const allowed = (await service.rpc("mailbox_customer_addresses", { p_account_id: account.id })).data!;
    expect(allowed).toContain(CUSTOMER);
    for (const email of internal) {
      expect(allowed, email).not.toContain(email);
      expect((await service.rpc("mailbox_customer_addresses", { p_account_id: account.id, p_customer_email: email })).data, email).toEqual([]);
    }

    // Even if a provider returned such a message, it is not stored
    const leak = gmailMessage("g-leak", { From: ADMIN_MAILBOX, To: SALES_MAILBOX, Subject: "Salary review", "Message-ID": `<leak-${stamp}@roofco.example>` }, { mimeType: "text/plain", text: "Confidential." });
    const before = (await service.from("email_messages").select("id", { count: "exact", head: true })).count;
    await syncAccount(account.id, { fetchImpl: fake((c) => (c.url.includes("/messages?") ? { body: { messages: [{ id: "g-leak" }] } } : { body: leak })) });
    expect((await service.from("email_messages").select("id", { count: "exact", head: true })).count).toBe(before);
    expect((await service.from("email_messages").select("id").eq("subject", "Salary review")).data).toEqual([]);
    const searched = calls.filter((c) => c.url.includes("/messages?")).map((c) => decodeURIComponent(c.url)).join("\n");
    expect(searched).not.toContain(ADMIN_MAILBOX);
    expect(searched).not.toContain("roofco.example");

    // An address that is not any customer's cannot be asked for either
    expect((await service.rpc("mailbox_customer_addresses", { p_account_id: account.id, p_customer_email: STRANGER })).data).toEqual([]);
    expect((await sales.rpc("mailbox_customer_addresses", { p_account_id: account.id })).error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("unlinking", () => {
  it("clears the tokens, stops syncing, and leaves the messages on the deal", async () => {
    const before = (await messages()).length;
    expect((await sales.rpc("disconnect_email_account")).data).toEqual({ ok: true });
    const account = await accountOf(salesId);
    expect(account).toMatchObject({ status: "disconnected", access_token_enc: null, refresh_token_enc: null });
    expect(await syncAccount(account.id, { fetchImpl: fake(() => ({})) })).toMatchObject({ stored: 0, error: "The mailbox is not linked" });
    expect(calls).toEqual([]);
    expect(await messages()).toHaveLength(before);
    expect((await field.rpc("disconnect_email_account")).error?.code).toBe(PERMISSION_DENIED);

    // Removing the mailbox row entirely (the rep leaves) still keeps the messages
    await service.from("email_accounts").delete().eq("user_id", salesId);
    expect(await messages()).toHaveLength(before);
    expect((await messages()).filter((m) => m.account_id === null).length).toBeGreaterThan(0);
  });
});
