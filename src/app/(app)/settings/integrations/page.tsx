import type { Metadata } from "next";
import { CopyLink } from "@/components/shared/copy-link";
import { emailProviderReady } from "@/features/email/providers";
import { GoogleCalendarControls, RetrySyncButton } from "@/features/settings/components/google-calendar-controls";
import { QuickBooksControls, RetryInvoiceButton } from "@/features/settings/components/quickbooks-controls";
import { LeadIngestionControls, RetrySubmissionButton } from "@/features/settings/components/lead-ingestion-controls";
import { requireRole } from "@/lib/auth";
import { formatDateTime, relativeTime } from "@/lib/dates";
import { appUrl, serverEnv } from "@/lib/env";
import { getTimeZone } from "@/lib/settings";
import { listQboOptions } from "@/lib/integrations/quickbooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Integrations" };

const STATUS_TONE: Record<string, string> = {
  created: "text-success",
  merged_duplicate: "text-muted-foreground",
  rejected: "text-muted-foreground",
  received: "text-warning",
  error: "text-destructive",
};
const STATUS_LABEL: Record<string, string> = {
  created: "Created",
  merged_duplicate: "Merged",
  rejected: "Rejected",
  received: "Waiting",
  error: "Error",
};

const GOOGLE_NOTICE: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Google Calendar is connected. Upcoming appointments are being added now." },
  cancelled: { tone: "bad", text: "Google sign-in was cancelled. Nothing changed." },
  error: { tone: "bad", text: "Google sign-in did not finish. Try again." },
  no_refresh_token: { tone: "bad", text: "Google did not grant ongoing access. Remove this app under your Google account's third-party access, then connect again." },
  not_configured: { tone: "bad", text: "Google is not set up yet: add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and INTEGRATION_ENCRYPTION_KEY in the Vercel project settings." },
};

const QBO_NOTICE: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "QuickBooks is connected. Choose the income item below before sending invoices." },
  cancelled: { tone: "bad", text: "QuickBooks sign-in was cancelled. Nothing changed." },
  error: { tone: "bad", text: "QuickBooks sign-in did not finish. Try again." },
  different_company: { tone: "bad", text: "That is a different QuickBooks company from the one this CRM has already sent customers or invoices to, so it was not connected. Nothing changed." },
  not_configured: { tone: "bad", text: "QuickBooks is not set up yet: add QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_ENVIRONMENT, and INTEGRATION_ENCRYPTION_KEY in the Vercel project settings." },
};

export default async function IntegrationsPage({ searchParams }: PageProps<"/settings/integrations">) {
  await requireRole("admin");
  const params = await searchParams;
  const googleNotice = typeof params.google === "string" ? GOOGLE_NOTICE[params.google] : undefined;
  const supabase = await createClient();
  const env = serverEnv();
  const base = appUrl();
  const [{ data: submissions }, emailStats] = await Promise.all([
    supabase.from("lead_submissions").select("id, channel, status, error, received_at, payload, opportunity_id").order("received_at", { ascending: false }).limit(20),
    // email_log is service-role only; this page is admin-gated (CLAUDE.md rule 4).
    createAdminClient().from("email_log").select("status", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  // Connection status and sync issues are service-role data, shown on this admin-gated screen (CLAUDE.md rule 4).
  const admin = createAdminClient();
  const [{ data: google }, { data: syncIssues }, { count: pendingSyncs }] = await Promise.all([
    admin.from("integration_connections").select("status, external_account_id, config, last_error, updated_at").eq("provider", "google_calendar").maybeSingle(),
    admin.from("appointments").select("id, title, starts_at, google_sync_error, opportunity_id").eq("google_sync_status", "error").order("starts_at").limit(50),
    admin.from("sync_outbox").select("id", { count: "exact", head: true }).eq("provider", "google_calendar").eq("status", "pending"),
  ]);
  const [{ data: qbo }, { data: invoiceIssues }] = await Promise.all([
    admin.from("integration_connections").select("status, external_account_id, config, last_error").eq("provider", "quickbooks").maybeSingle(),
    admin.from("invoices").select("id, invoice_number, qbo_sync_error, job_id").eq("qbo_sync_status", "error").order("invoice_number").limit(50),
  ]);
  const qboReady = Boolean(env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET && env.INTEGRATION_ENCRYPTION_KEY);
  const qboConnected = qbo?.status === "connected" || qbo?.status === "error";
  const qboConfig = (qbo?.config ?? {}) as { environment?: string; company_name?: string; item_id?: string; item_name?: string; tax_code_id?: string | null };
  // Live lists from QuickBooks for the pickers; if it cannot be reached the card says so.
  const qboOptions = qbo?.status === "connected" ? await listQboOptions().catch(() => null) : null;
  const quickbooksNotice = typeof params.quickbooks === "string" ? QBO_NOTICE[params.quickbooks] : undefined;
  const emailReady = { google: emailProviderReady("google"), microsoft: emailProviderReady("microsoft") };
  const { count: linkedMailboxes } = await admin.from("email_accounts").select("id", { count: "exact", head: true }).eq("status", "connected");
  const googleReady = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.INTEGRATION_ENCRYPTION_KEY);
  const googleConnected = google?.status === "connected" || google?.status === "error";
  const calendarName = (google?.config as { calendar_name?: string } | null)?.calendar_name;
  const timeZone = await getTimeZone();

  const configured = {
    website: Boolean(env.LEAD_WEBHOOK_SECRET),
    googleAds: Boolean(env.GOOGLE_ADS_WEBHOOK_KEY),
    email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
  };

  return (
    <div className="max-w-3xl space-y-8">
      <section aria-label="Google Calendar" className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Google Calendar</h2>
          <p className="text-muted-foreground">
            Every appointment is copied to a shared calendar, and whoever is assigned gets it on their own Google calendar. It is one way: changes made in Google are overwritten.
          </p>
        </div>
        {googleNotice ? (
          <p role="status" className={cn("rounded-md border p-3", googleNotice.tone === "ok" ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive")}>
            {googleNotice.text}
          </p>
        ) : null}
        <div className="space-y-3 rounded-md border bg-card p-3">
          <h3 className="flex items-center gap-2 font-medium">
            Connection
            <span className={cn("rounded px-1.5 text-xs font-medium", google?.status === "connected" ? "bg-success/10 text-success" : google?.status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
              {google?.status === "connected" ? "Connected" : google?.status === "error" ? "Needs reconnecting" : "Not connected"}
            </span>
          </h3>
          {googleConnected ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Account</dt>
              <dd className="truncate">{google?.external_account_id ?? "Unknown"}</dd>
              <dt className="text-muted-foreground">Calendar</dt>
              <dd className="truncate">{calendarName ?? "CRM calendar"}</dd>
              <dt className="text-muted-foreground">Waiting to sync</dt>
              <dd className="tabular">{pendingSyncs ?? 0}</dd>
            </dl>
          ) : null}
          {google?.status === "error" && google.last_error ? <p className="text-destructive">{google.last_error}</p> : null}
          {googleReady ? (
            <GoogleCalendarControls connected={googleConnected} />
          ) : (
            <p className="text-muted-foreground">
              Not set up yet: create a Google Cloud OAuth client and add <code className="rounded bg-muted px-1">GOOGLE_CLIENT_ID</code>, <code className="rounded bg-muted px-1">GOOGLE_CLIENT_SECRET</code>, and{" "}
              <code className="rounded bg-muted px-1">INTEGRATION_ENCRYPTION_KEY</code> in the Vercel project settings. Register this redirect address on the OAuth client:
            </p>
          )}
          {googleReady ? null : <CopyLink link={`${base}/api/integrations/google/callback`} label="Google redirect URI" />}
          <p className="text-xs text-muted-foreground">
            The OAuth consent screen must be <strong>Internal</strong> (Google Workspace) or published <strong>In production</strong>. An app left in &quot;Testing&quot; is signed out by Google every 7 days.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="font-medium">Sync issues</h3>
          {!syncIssues?.length ? (
            <p className="text-muted-foreground">No appointments have failed to sync.</p>
          ) : (
            <ul className="divide-y rounded-md border bg-card">
              {syncIssues.map((issue) => (
                <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{issue.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDateTime(issue.starts_at, timeZone)} · {issue.google_sync_error ?? "Unknown error"}
                    </p>
                  </div>
                  <RetrySyncButton appointmentId={issue.id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="QuickBooks" className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">QuickBooks Online</h2>
          <p className="text-muted-foreground">
            An admin sends an invoice to QuickBooks with one click from the job; payment status comes back here. Nothing is sent automatically. Without QuickBooks, invoices are marked sent and paid by hand on the job.
          </p>
        </div>
        {quickbooksNotice ? (
          <p role="status" className={cn("rounded-md border p-3", quickbooksNotice.tone === "ok" ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive")}>
            {quickbooksNotice.text}
          </p>
        ) : null}
        <div className="space-y-3 rounded-md border bg-card p-3">
          <h3 className="flex items-center gap-2 font-medium">
            Connection
            <span className={cn("rounded px-1.5 text-xs font-medium", qbo?.status === "connected" ? "bg-success/10 text-success" : qbo?.status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
              {qbo?.status === "connected" ? "Connected" : qbo?.status === "error" ? "Needs reconnecting" : "Not connected"}
            </span>
          </h3>
          {qboConnected ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Company</dt>
              <dd className="truncate">{qboConfig.company_name ?? qbo?.external_account_id}</dd>
              <dt className="text-muted-foreground">Environment</dt>
              <dd>{qboConfig.environment === "production" ? "Production" : "Sandbox (test company)"}</dd>
              <dt className="text-muted-foreground">Income item</dt>
              <dd>{qboConfig.item_name ?? "Not chosen yet"}</dd>
            </dl>
          ) : null}
          {qbo?.status === "error" && qbo.last_error ? <p className="text-destructive">{qbo.last_error}</p> : null}
          {qbo?.status === "connected" && !qboOptions ? <p className="text-destructive">QuickBooks could not be reached to load its items. Reload this page to try again.</p> : null}
          {qboReady ? (
            <QuickBooksControls connected={qboConnected} options={qboOptions} itemId={qboConfig.item_id ?? ""} taxCodeId={qboConfig.tax_code_id ?? ""} />
          ) : (
            <>
              <p className="text-muted-foreground">
                Not set up yet: create an app in the Intuit developer portal and add <code className="rounded bg-muted px-1">QBO_CLIENT_ID</code>, <code className="rounded bg-muted px-1">QBO_CLIENT_SECRET</code>,{" "}
                <code className="rounded bg-muted px-1">QBO_ENVIRONMENT</code> (sandbox or production) and <code className="rounded bg-muted px-1">INTEGRATION_ENCRYPTION_KEY</code> in the Vercel project settings. Register this redirect address:
              </p>
              <CopyLink link={`${base}/api/integrations/quickbooks/callback`} label="QuickBooks redirect URI" />
            </>
          )}
        </div>
        {invoiceIssues?.length ? (
          <div className="space-y-2">
            <h3 className="font-medium">Invoice sync issues</h3>
            <ul className="divide-y rounded-md border bg-card">
              {invoiceIssues.map((issue) => (
                <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium tabular">INV-{issue.invoice_number}</p>
                    <p className="truncate text-xs text-muted-foreground">{issue.qbo_sync_error ?? "Unknown error"}</p>
                  </div>
                  <RetryInvoiceButton invoiceId={issue.id} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-label="Email accounts" className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Email accounts</h2>
          <p className="text-muted-foreground">
            Each admin and sales user links their own mailbox under Settings → Profile. Email to and from customers then appears on their deals, and email can be sent from a deal. This section is the one-time
            company setup.
          </p>
        </div>
        <div className="space-y-3 rounded-md border bg-card p-3">
          <h3 className="flex items-center gap-2 font-medium">
            Google Workspace <Configured ok={emailReady.google} />
          </h3>
          <p className="text-muted-foreground">
            Uses the same Google Cloud OAuth client as the calendar (<code className="rounded bg-muted px-1">GOOGLE_CLIENT_ID</code>, <code className="rounded bg-muted px-1">GOOGLE_CLIENT_SECRET</code>). Enable the Gmail API, add the
            scopes <code className="rounded bg-muted px-1">gmail.readonly</code> and <code className="rounded bg-muted px-1">gmail.send</code>, keep the consent screen <strong>Internal</strong>, and register this redirect address:
          </p>
          <CopyLink link={`${base}/api/integrations/email/google/callback`} label="Google email redirect URI" />
        </div>
        <div className="space-y-3 rounded-md border bg-card p-3">
          <h3 className="flex items-center gap-2 font-medium">
            Microsoft 365 <Configured ok={emailReady.microsoft} />
          </h3>
          <p className="text-muted-foreground">
            Create an app registration in Microsoft Entra with delegated permissions <code className="rounded bg-muted px-1">Mail.Read</code>, <code className="rounded bg-muted px-1">Mail.Send</code>,{" "}
            <code className="rounded bg-muted px-1">User.Read</code> and <code className="rounded bg-muted px-1">offline_access</code>, then add <code className="rounded bg-muted px-1">MICROSOFT_CLIENT_ID</code>,{" "}
            <code className="rounded bg-muted px-1">MICROSOFT_CLIENT_SECRET</code> and <code className="rounded bg-muted px-1">MICROSOFT_TENANT_ID</code> (your organisation&apos;s tenant id; sign-in is limited to it) in the Vercel project settings. Register it as a single-tenant app. Register this
            redirect address (type Web):
          </p>
          <CopyLink link={`${base}/api/integrations/email/microsoft/callback`} label="Microsoft email redirect URI" />
        </div>
        <p className="text-muted-foreground">
          {linkedMailboxes ?? 0} mailbox{linkedMailboxes === 1 ? "" : "es"} linked. Both providers also need <code className="rounded bg-muted px-1">INTEGRATION_ENCRYPTION_KEY</code>.
        </p>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Automatic lead capture</h2>
          <p className="text-muted-foreground">Leads from the website and Google Ads arrive here and are created, or merged into an open deal for the same customer and address.</p>
        </div>

        <div className="space-y-3 rounded-md border bg-card p-3">
          <h3 className="flex items-center gap-2 font-medium">
            Website form <Configured ok={configured.website} />
          </h3>
          <CopyLink link={`${base}/api/webhooks/leads/website`} label="Website webhook URL" />
          <p className="text-muted-foreground">
            Your website&apos;s <strong>server</strong> (or its form plugin&apos;s webhook feature, or a Zapier / Make step) sends each submission to this URL as JSON, with the header{" "}
            <code className="rounded bg-muted px-1">X-Webhook-Secret</code> set to the <code className="rounded bg-muted px-1">LEAD_WEBHOOK_SECRET</code> value from the Vercel project
            settings. Never put the secret in browser code.
          </p>
          <p className="text-muted-foreground">
            Fields: <code className="rounded bg-muted px-1">name</code> (or first_name, last_name), <code className="rounded bg-muted px-1">phone</code>,{" "}
            <code className="rounded bg-muted px-1">email</code>, address, city, state, zip, service, message. Pass along <code className="rounded bg-muted px-1">gclid</code>, utm_source,
            utm_medium and utm_campaign so paid clicks are credited to Google Ads. A hidden field named <code className="rounded bg-muted px-1">website</code> acts as a spam trap: real
            visitors leave it empty.
          </p>
        </div>

        <div className="space-y-3 rounded-md border bg-card p-3">
          <h3 className="flex items-center gap-2 font-medium">
            Google Ads lead forms <Configured ok={configured.googleAds} />
          </h3>
          <CopyLink link={`${base}/api/webhooks/leads/google-ads`} label="Google Ads webhook URL" />
          <p className="text-muted-foreground">
            In Google Ads, open the lead form asset, choose <em>Webhook</em> under lead delivery, paste this URL, and enter the{" "}
            <code className="rounded bg-muted px-1">GOOGLE_ADS_WEBHOOK_KEY</code> value from the Vercel project settings as the key. Use Google&apos;s &quot;Send test data&quot; to check
            the connection; test leads are recorded as rejected and create nothing.
          </p>
        </div>

        <div className="space-y-2 rounded-md border bg-card p-3">
          <h3 className="flex items-center gap-2 font-medium">
            Email notifications <Configured ok={configured.email} />
          </h3>
          <p className="text-muted-foreground">
            {configured.email
              ? "New-lead and follow-up emails are sent through Resend."
              : "Not set up yet: add RESEND_API_KEY and EMAIL_FROM in the Vercel project settings. Until then emails are recorded as failed and can be retried once it is configured."}
            {(emailStats.count ?? 0) > 0 ? ` ${emailStats.count} email${emailStats.count === 1 ? "" : "s"} waiting to be retried.` : ""}
          </p>
        </div>

        <LeadIngestionControls />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Recent submissions</h2>
        {!submissions?.length ? (
          <p className="text-muted-foreground">Nothing received yet.</p>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {submissions.map((s) => {
              const payload = (s.payload ?? {}) as Record<string, unknown>;
              const who = [payload.name, payload.first_name, payload.last_name].filter((v) => typeof v === "string" && v).join(" ") || "Unnamed";
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {who} <span className="font-normal text-muted-foreground">· {s.channel === "google_ads" ? "Google Ads" : "Website"} · {relativeTime(s.received_at)}</span>
                    </p>
                    {s.error ? <p className="truncate text-muted-foreground">{s.error}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("font-medium", STATUS_TONE[s.status])}>{STATUS_LABEL[s.status] ?? s.status}</span>
                    {s.status === "error" || s.status === "received" ? <RetrySubmissionButton id={s.id} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Configured({ ok }: { ok: boolean }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", ok ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
      {ok ? "Ready" : "Not configured"}
    </span>
  );
}
