import type { Metadata } from "next";
import { CopyLink } from "@/components/shared/copy-link";
import { GoogleCalendarControls, RetrySyncButton } from "@/features/settings/components/google-calendar-controls";
import { LeadIngestionControls, RetrySubmissionButton } from "@/features/settings/components/lead-ingestion-controls";
import { requireRole } from "@/lib/auth";
import { formatDateTime, relativeTime } from "@/lib/dates";
import { appUrl, serverEnv } from "@/lib/env";
import { getTimeZone } from "@/lib/settings";
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
