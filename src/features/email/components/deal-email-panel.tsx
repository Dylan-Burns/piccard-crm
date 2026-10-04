"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { ArrowDownLeft, ArrowUpRight, Paperclip, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { useActionToast } from "@/components/shared/use-action-toast";
import { checkDealEmail, sendDealEmail } from "@/features/email/actions";
import type { DealEmail } from "@/features/email/queries";

type Props = {
  opportunityId: string;
  customerEmail: string | null;
  /** The signed-in user's mailbox, when linked and working. */
  mailbox: { email: string } | null;
  mailboxNeedsRelink: boolean;
  emails: DealEmail[];
  /** Shown when no mailbox is linked: the form for logging an email sent some other way. */
  children: React.ReactNode;
};

/** The deal's Email tab: write as yourself, check your mailbox for this customer, and read the conversation. */
export function DealEmailPanel({ opportunityId, customerEmail, mailbox, mailboxNeedsRelink, emails, children }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [sendState, send, sending] = useActionState(sendDealEmail, null);
  const [checkState, check, checking] = useActionState(checkDealEmail, null);
  useActionToast(sendState, sendState?.ok ? `Email sent to ${sendState.data.to}` : "Email sent", () => formRef.current?.reset());
  useActionToast(checkState, checkState?.ok ? (checkState.data.stored === 0 ? "No new email" : `${checkState.data.stored} new email${checkState.data.stored === 1 ? "" : "s"}`) : "Checked");
  const errors = sendState?.ok === false ? sendState.error.fields : undefined;

  return (
    <section aria-label="Email" className="space-y-4">
      {mailbox ? (
        customerEmail ? (
          <form ref={formRef} action={send} className="space-y-3">
            <input type="hidden" name="opportunity_id" value={opportunityId} />
            <p className="text-muted-foreground">
              From <span className="font-medium text-foreground">{mailbox.email}</span> to <span className="font-medium text-foreground">{customerEmail}</span>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="email-subject">Subject</Label>
              <Input id="email-subject" name="subject" required maxLength={300} className="h-11 md:h-9" />
              <FieldError message={errors?.subject} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-body">Message</Label>
              <Textarea id="email-body" name="body" required rows={6} />
              <FieldError message={errors?.body} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="h-11 md:h-9" disabled={sending}>
                <Send className="size-4" aria-hidden />
                {sending ? "Sending…" : "Send email"}
              </Button>
              <Button type="submit" formAction={check} formNoValidate variant="outline" className="h-11 md:h-9" disabled={checking}>
                <RefreshCw className="size-4" aria-hidden />
                Check for new email
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-muted-foreground">This customer has no email address. Add one under Customer to send email from here.</p>
        )
      ) : (
        <div className="space-y-3">
          <p className="rounded-md border bg-muted/50 p-3">
            {mailboxNeedsRelink ? "Your email account needs to be linked again. " : "Link your work email to send from here as yourself and see customer replies on the deal. "}
            <Link href="/settings/profile" className="font-medium text-primary underline">
              {mailboxNeedsRelink ? "Link it again" : "Link your email account"}
            </Link>
          </p>
          <div>
            <h3 className="mb-2 text-sm font-medium">Or log an email you sent another way</h3>
            <div>{children}</div>
          </div>
        </div>
      )}

      {emails.length > 0 ? (
        <ul aria-label="Conversation" className="divide-y rounded-md border bg-card">
          {emails.map((email) => (
            <li key={email.id}>
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                  {email.direction === "inbound" ? <ArrowDownLeft className="mt-0.5 size-4 shrink-0 text-success" aria-label="Received" /> : <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Sent" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {email.subject}
                      {email.hasAttachments ? <Paperclip className="ml-1.5 inline size-3.5 text-muted-foreground" aria-label="Has attachments" /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground group-open:hidden">{email.snippet}</span>
                    <span className="hidden text-xs text-muted-foreground group-open:block">
                      {email.from} → {email.to}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">{email.when}</span>
                </summary>
                <p className="border-t bg-muted/40 px-3 py-2 whitespace-pre-wrap">{email.body || email.snippet}</p>
              </details>
            </li>
          ))}
        </ul>
      ) : mailbox ? (
        <p className="text-muted-foreground">No email with this customer yet.</p>
      ) : null}
    </section>
  );
}
