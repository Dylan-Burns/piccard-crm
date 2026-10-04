"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/shared/use-action-toast";
import { disconnectMailbox } from "@/features/email/actions";

type Props = {
  mailbox: { provider: "google" | "microsoft"; email: string; status: string; lastSynced: string | null; lastError: string | null } | null;
  ready: { google: boolean; microsoft: boolean };
  notice: { tone: "ok" | "bad"; text: string } | null;
};

/** Link, relink, or unlink the signed-in user's own mailbox. */
export function MailboxCard({ mailbox, ready, notice }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(disconnectMailbox, null);
  useActionToast(state, "Mailbox unlinked", () => setConfirming(false));
  const linked = mailbox && mailbox.status !== "disconnected";

  return (
    <section aria-label="Email account" className="space-y-3 rounded-md border bg-card p-3">
      <div>
        <h2 className="text-base font-semibold">Email account</h2>
        <p className="text-muted-foreground">
          Link your work mailbox to send email from a deal as yourself, and to have email to and from customers appear on their deals. Only messages involving a customer are copied; the rest of
          your mailbox is never stored.
        </p>
      </div>
      {notice ? (
        <p role="status" className={notice.tone === "ok" ? "rounded-md border border-success/40 bg-success/10 p-2.5 text-success" : "rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-destructive"}>
          {notice.text}
        </p>
      ) : null}
      {linked ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Mailbox</dt>
          <dd className="truncate font-medium">{mailbox.email}</dd>
          <dt className="text-muted-foreground">Provider</dt>
          <dd>{mailbox.provider === "google" ? "Google" : "Microsoft 365"}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd className={mailbox.status === "connected" ? "text-success" : "text-destructive"}>{mailbox.status === "connected" ? "Linked" : "Needs linking again"}</dd>
          <dt className="text-muted-foreground">Last checked</dt>
          <dd>{mailbox.lastSynced ?? "Not yet"}</dd>
        </dl>
      ) : (
        <p className="text-muted-foreground">No mailbox linked.</p>
      )}
      {linked && mailbox.lastError ? <p className="text-destructive">{mailbox.lastError}</p> : null}
      <div className="flex flex-wrap gap-2">
        {/* Full navigations: these routes redirect to the provider's sign-in page. */}
        {ready.google ? (
          <Button asChild variant={linked ? "outline" : "default"} className="h-11 md:h-9">
            <a href="/api/integrations/email/google/connect">{linked && mailbox.provider === "google" ? "Link Google again" : "Link Google account"}</a>
          </Button>
        ) : null}
        {ready.microsoft ? (
          <Button asChild variant={linked ? "outline" : "default"} className="h-11 md:h-9">
            <a href="/api/integrations/email/microsoft/connect">{linked && mailbox.provider === "microsoft" ? "Link Microsoft again" : "Link Microsoft 365 account"}</a>
          </Button>
        ) : null}
        {linked ? (
          <form action={action}>
            {confirming ? (
              <Button key="confirm" type="submit" variant="destructive" className="h-11 md:h-9" disabled={pending}>
                Confirm unlink
              </Button>
            ) : (
              // A distinct key: otherwise React reuses this <button>, flips it to type=submit during
              // the click, and the form submits without the confirmation step.
              <Button key="ask" type="button" variant="ghost" className="h-11 text-red-600 md:h-9" onClick={() => setConfirming(true)}>
                Unlink
              </Button>
            )}
          </form>
        ) : null}
      </div>
      {!ready.google && !ready.microsoft ? (
        <p className="text-muted-foreground">Email linking has not been set up for this company yet. An admin needs to add the Google or Microsoft sign-in details.</p>
      ) : null}
    </section>
  );
}
