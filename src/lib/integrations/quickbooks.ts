import "server-only";
import { serverEnv } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/integrations/crypto";
import { ConnectionError, FatalError, RetryableError } from "@/lib/integrations/errors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * QuickBooks Online (spec §6.3). REST with `fetch`, no SDK. One way: the CRM pushes a customer
 * and an invoice when an admin clicks Send, and pulls payment status hourly. Once an invoice is
 * in QuickBooks, QuickBooks owns it.
 */

export type Fetch = typeof fetch;
type Db = ReturnType<typeof createAdminClient>;
type Config = { environment?: "sandbox" | "production"; item_id?: string; item_name?: string; tax_code_id?: string; company_name?: string };

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
const MINOR_VERSION = "75";

const baseUrl = (environment: string | undefined) => (environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com");
/** Escapes a value for QuickBooks' query language (single-quoted strings). */
const quote = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

function credentials() {
  const env = serverEnv();
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) throw new ConnectionError("QuickBooks is not configured (QBO_CLIENT_ID / QBO_CLIENT_SECRET)");
  return { basic: Buffer.from(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`).toString("base64"), clientId: env.QBO_CLIENT_ID, environment: env.QBO_ENVIRONMENT ?? "sandbox" };
}
export const qboEnvironment = () => credentials().environment;
export const qboClientId = () => credentials().clientId;

async function tokenRequest(params: Record<string, string>, fetchImpl: Fetch) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials().basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  }).catch(() => null);
  if (!response) throw new RetryableError("Could not reach Intuit");
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    if (response.status >= 500) throw new RetryableError(`Intuit returned ${response.status}`);
    throw new ConnectionError(body.error === "invalid_grant" ? "QuickBooks access was revoked or expired. Reconnect QuickBooks." : `Intuit refused the sign-in (${body.error ?? response.status})`);
  }
  return body as { access_token: string; refresh_token: string; expires_in?: number };
}

export const exchangeQboCode = (code: string, redirectUri: string, fetchImpl: Fetch = fetch) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchImpl);

/**
 * The ids saved from QuickBooks (customer links, sent invoices) belong to one company. Connecting
 * a different company while any exist would send invoices to, and read payments from, whatever
 * has the same ids there, so the callback refuses it. The company id is kept on disconnect.
 */
export async function linkedToOtherCompany(realmId: string, db: Db = createAdminClient()): Promise<boolean> {
  const { data: existing } = await db.from("integration_connections").select("external_account_id").eq("provider", "quickbooks").maybeSingle();
  if (!existing?.external_account_id || existing.external_account_id === realmId) return false;
  const [linkedCustomers, sentInvoices] = await Promise.all([
    db.from("customers").select("id", { count: "exact", head: true }).not("qbo_customer_id", "is", null),
    db.from("invoices").select("id", { count: "exact", head: true }).not("qbo_invoice_id", "is", null),
  ]);
  // If it cannot be checked, assume there are links.
  if (linkedCustomers.error || sentInvoices.error) return true;
  return (linkedCustomers.count ?? 0) + (sentInvoices.count ?? 0) > 0;
}

async function markConnectionError(db: Db, message: string) {
  await db.from("integration_connections").update({ status: "error", last_error: message.slice(0, 500) }).eq("provider", "quickbooks");
}

type Session = { token: string; realmId: string; config: Config; api: string };

/**
 * A usable access token plus where to send requests. Intuit rotates the refresh token on every
 * refresh, so only one worker may refresh at a time (`lock_integration`) and the new refresh
 * token is always saved; losing it would disconnect the company.
 */
export async function getQboSession(fetchImpl: Fetch = fetch, db: Db = createAdminClient(), forceRefresh = false): Promise<Session> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: connection } = await db.from("integration_connections").select("status, access_token_enc, refresh_token_enc, expires_at, external_account_id, config").eq("provider", "quickbooks").maybeSingle();
    if (!connection || connection.status === "disconnected") throw new ConnectionError("QuickBooks is not connected");
    if (connection.status === "error") throw new ConnectionError("QuickBooks needs to be reconnected");
    if (!connection.access_token_enc || !connection.refresh_token_enc || !connection.external_account_id) throw new ConnectionError("QuickBooks is not fully connected. Reconnect it.");
    const config = (connection.config ?? {}) as Config;
    const session = { realmId: connection.external_account_id, config, api: `${baseUrl(config.environment)}/v3/company/${connection.external_account_id}` };

    const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
    if (!forceRefresh && expiresAt - Date.now() > 5 * 60_000) return { ...session, token: decrypt(connection.access_token_enc) };

    const { data: gotLease } = await db.rpc("lock_integration", { p_provider: "quickbooks" });
    if (!gotLease) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      forceRefresh = false; // whoever holds the lease is refreshing: read what they save
      continue;
    }
    try {
      const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(connection.refresh_token_enc) }, fetchImpl);
      const { error } = await db
        .from("integration_connections")
        .update({ access_token_enc: encrypt(refreshed.access_token), refresh_token_enc: encrypt(refreshed.refresh_token), expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(), last_error: null })
        .eq("provider", "quickbooks");
      if (error) throw new RetryableError("Could not save the new QuickBooks token");
      return { ...session, token: refreshed.access_token };
    } catch (error) {
      if (error instanceof ConnectionError) await markConnectionError(db, error.message);
      throw error;
    } finally {
      await db.rpc("unlock_integration", { p_provider: "quickbooks" });
    }
  }
  throw new RetryableError("Timed out waiting for the QuickBooks token to refresh");
}

type Fault = { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } };
class QboFault extends FatalError {
  constructor(message: string, readonly code: string | undefined) {
    super(message);
  }
}

/** One API call. A 401 gets one refresh and one more try; after that the connection is broken. */
async function request<T>(fetchImpl: Fetch, db: Db, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let session = await getQboSession(fetchImpl, db);
  for (let attempt = 0; attempt < 2; attempt++) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await fetchImpl(`${session.api}${path}${separator}minorversion=${MINOR_VERSION}`, {
      method,
      headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    if (!response) throw new RetryableError("Could not reach QuickBooks");
    if (response.status === 401) {
      if (attempt === 0) {
        session = await getQboSession(fetchImpl, db, true);
        continue;
      }
      const message = "QuickBooks rejected the connection. Reconnect QuickBooks.";
      await markConnectionError(db, message);
      throw new ConnectionError(message);
    }
    if (response.status === 429 || response.status >= 500) throw new RetryableError(`QuickBooks returned ${response.status}`);
    const json = (await response.json().catch(() => ({}))) as T & Fault;
    if (!response.ok || json.Fault) {
      const fault = json.Fault?.Error?.[0];
      // Validation errors will not fix themselves: fail at once and show Intuit's message.
      throw new QboFault([fault?.Message, fault?.Detail].filter(Boolean).join(": ") || `QuickBooks returned ${response.status}`, fault?.code);
    }
    return json;
  }
  throw new RetryableError("QuickBooks request failed");
}

const query = <T>(fetchImpl: Fetch, db: Db, sql: string) => request<{ QueryResponse?: T }>(fetchImpl, db, "GET", `/query?query=${encodeURIComponent(sql)}`).then((r) => r.QueryResponse ?? ({} as T));

/** Live lists for the settings pickers. */
export async function listQboOptions(fetchImpl: Fetch = fetch, db: Db = createAdminClient()) {
  const [items, taxCodes] = await Promise.all([
    query<{ Item?: { Id: string; Name: string }[] }>(fetchImpl, db, "select Id, Name from Item where Type = 'Service' and Active = true maxresults 200"),
    query<{ TaxCode?: { Id: string; Name: string }[] }>(fetchImpl, db, "select Id, Name from TaxCode where Active = true maxresults 200"),
  ]);
  return { items: (items.Item ?? []).map((i) => ({ id: i.Id, name: i.Name })), taxCodes: (taxCodes.TaxCode ?? []).map((t) => ({ id: t.Id, name: t.Name })) };
}

export async function getQboCompanyName(fetchImpl: Fetch = fetch, db: Db = createAdminClient()): Promise<string | null> {
  const session = await getQboSession(fetchImpl, db);
  const result = await request<{ CompanyInfo?: { CompanyName?: string } }>(fetchImpl, db, "GET", `/companyinfo/${session.realmId}`);
  return result.CompanyInfo?.CompanyName ?? null;
}

type CrmCustomer = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; qbo_customer_id: string | null; address_line1: string | null };

/**
 * The QuickBooks customer for a CRM customer: the saved link, else one found by email, else by
 * exact name, else a new one. QuickBooks names must be unique across customers, vendors, and
 * employees; on a clash the address is added to the name once.
 */
export async function findOrCreateCustomer(customer: CrmCustomer, fetchImpl: Fetch = fetch, db: Db = createAdminClient()): Promise<string> {
  if (customer.qbo_customer_id) return customer.qbo_customer_id;
  const name = `${customer.first_name} ${customer.last_name}`.trim();
  if (customer.email) {
    const byEmail = await query<{ Customer?: { Id: string }[] }>(fetchImpl, db, `select Id from Customer where PrimaryEmailAddr = ${quote(customer.email)}`);
    if (byEmail.Customer?.[0]) return byEmail.Customer[0].Id;
  }
  const byName = await query<{ Customer?: { Id: string }[] }>(fetchImpl, db, `select Id from Customer where DisplayName = ${quote(name)}`);
  if (byName.Customer?.[0]) return byName.Customer[0].Id;

  const body = (displayName: string) => ({
    DisplayName: displayName,
    GivenName: customer.first_name,
    FamilyName: customer.last_name,
    ...(customer.email ? { PrimaryEmailAddr: { Address: customer.email } } : {}),
    ...(customer.phone ? { PrimaryPhone: { FreeFormNumber: customer.phone } } : {}),
  });
  try {
    return (await request<{ Customer: { Id: string } }>(fetchImpl, db, "POST", "/customer", body(name))).Customer.Id;
  } catch (error) {
    // 6240: the name is already used (by a vendor or employee, since no customer matched).
    if (error instanceof QboFault && error.code === "6240" && customer.address_line1) {
      return (await request<{ Customer: { Id: string } }>(fetchImpl, db, "POST", "/customer", body(`${name} — ${customer.address_line1}`))).Customer.Id;
    }
    throw error;
  }
}

/**
 * Pushes one invoice. `requestid` is the CRM invoice id, so Intuit returns the same invoice for a
 * repeated request instead of creating another. Records the result through complete_invoice_sync.
 */
export async function syncInvoice(invoiceId: string, fetchImpl: Fetch = fetch, db: Db = createAdminClient()): Promise<"synced" | "skipped"> {
  const { data: invoice } = await db
    .from("invoices")
    .select(
      `id, invoice_number, status, total_cents, tax_cents, due_on, qbo_invoice_id, job:jobs!inner(job_number),
       customer:customers!inner(id, first_name, last_name, email, phone, qbo_customer_id, properties(address_line1, is_primary)),
       invoice_line_items(description, amount_cents, sort_order)`,
    )
    .eq("id", invoiceId)
    .maybeSingle();
  // Already there, voided, or gone since it was queued: nothing to push.
  if (!invoice || invoice.qbo_invoice_id || invoice.status !== "draft") return "skipped";

  const session = await getQboSession(fetchImpl, db);
  if (!session.config.item_id) throw new FatalError("Choose the QuickBooks income item in Settings first");
  const property = invoice.customer.properties.find((p) => p.is_primary) ?? invoice.customer.properties[0];
  const hadCustomer = Boolean(invoice.customer.qbo_customer_id);
  const customerRef = await findOrCreateCustomer({ ...invoice.customer, address_line1: property?.address_line1 ?? null }, fetchImpl, db);

  const taxed = invoice.tax_cents > 0;
  if (taxed && !session.config.tax_code_id) throw new FatalError("This invoice has tax. Choose the QuickBooks tax code in Settings first.");
  const lines = [...invoice.invoice_line_items].sort((a, b) => a.sort_order - b.sort_order);
  const created = await request<{ Invoice: { Id: string; DocNumber?: string; TotalAmt?: number } }>(fetchImpl, db, "POST", `/invoice?requestid=${invoice.id}`, {
    CustomerRef: { value: customerRef },
    ...(invoice.due_on ? { DueDate: invoice.due_on } : {}),
    PrivateNote: `CRM invoice INV-${invoice.invoice_number} / job J-${invoice.job.job_number}`,
    Line: lines.map((line) => ({
      DetailType: "SalesItemLineDetail",
      Amount: line.amount_cents / 100,
      Description: line.description,
      SalesItemLineDetail: { ItemRef: { value: session.config.item_id }, TaxCodeRef: { value: taxed ? session.config.tax_code_id : "NON" } },
    })),
    ...(taxed ? { TxnTaxDetail: { TotalTax: invoice.tax_cents / 100 } } : {}),
  });

  const qboTotal = Math.round((created.Invoice.TotalAmt ?? 0) * 100);
  const warning = qboTotal === invoice.total_cents ? null : `Total differs in QuickBooks: ${(qboTotal / 100).toFixed(2)}`;
  const { error } = await db.rpc("complete_invoice_sync", {
    p_invoice_id: invoice.id,
    p_qbo_invoice_id: created.Invoice.Id,
    p_doc_number: created.Invoice.DocNumber ?? created.Invoice.Id,
    ...(hadCustomer ? {} : { p_qbo_customer_id: customerRef }),
    ...(warning ? { p_warning: warning } : {}),
  });
  if (error) throw new RetryableError("QuickBooks accepted the invoice but it could not be recorded; it will be retried safely");
  return "synced";
}

/**
 * Hourly: what has been paid in QuickBooks on invoices the CRM is waiting on. An invoice that is
 * no longer there (deleted or voided in QuickBooks) becomes void here.
 */
export async function pullPayments(fetchImpl: Fetch = fetch, db: Db = createAdminClient()): Promise<{ checked: number; changed: number }> {
  const { data: open } = await db.from("invoices").select("id, qbo_invoice_id").not("qbo_invoice_id", "is", null).in("status", ["sent", "partially_paid"]).limit(1000);
  let changed = 0;
  for (let i = 0; i < (open?.length ?? 0); i += 30) {
    const batch = open!.slice(i, i + 30);
    const result = await query<{ Invoice?: { Id: string; Balance: number; TotalAmt: number }[] }>(
      fetchImpl,
      db,
      `select Id, Balance, TotalAmt from Invoice where Id in (${batch.map((b) => quote(b.qbo_invoice_id!)).join(", ")})`,
    );
    const found = new Map((result.Invoice ?? []).map((inv) => [inv.Id, inv]));
    for (const row of batch) {
      const remote = found.get(row.qbo_invoice_id!);
      const { data: outcome } = await db.rpc("apply_invoice_payment", {
        p_invoice_id: row.id,
        p_amount_paid_cents: remote ? Math.round((remote.TotalAmt - remote.Balance) * 100) : 0,
        p_missing: !remote,
      });
      if (outcome && outcome !== "unchanged" && outcome !== "ignored") changed += 1;
    }
  }
  return { checked: open?.length ?? 0, changed };
}
