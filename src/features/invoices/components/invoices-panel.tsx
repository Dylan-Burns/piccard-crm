"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markInvoiceSent, recordInvoicePayment, regenerateInvoices, sendInvoiceToQuickBooks, setInvoiceDueDate, voidInvoice } from "@/features/invoices/actions";
import type { ActionResult } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type Enums = Database["public"]["Enums"];
export type InvoiceRow = {
  id: string;
  label: string;
  kind: Enums["invoice_kind"];
  status: Enums["invoice_status"];
  total: string;
  paid: string;
  /** Dollars, for the payment field. */
  paidInput: string;
  dueOn: string;
  sync: Enums["sync_status"];
  syncError: string | null;
  qboNumber: string | null;
};

const STATUS_LABELS: Record<Enums["invoice_status"], string> = { draft: "Draft", sent: "Sent", partially_paid: "Partially paid", paid: "Paid", void: "Void" };
const STATUS_TONE: Record<Enums["invoice_status"], string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary/10 text-primary",
  partially_paid: "bg-amber-500/10 text-amber-700",
  paid: "bg-success/10 text-success",
  void: "bg-muted text-muted-foreground line-through",
};

/**
 * A job's invoices. Everyone on staff sees them; admins get the controls. Amounts are never
 * edited here: they come from the accepted estimate (Regenerate rebuilds the drafts from it).
 * Once an invoice is in QuickBooks it is read-only here and corrected there.
 */
export function InvoicesPanel({ jobId, invoices, isAdmin, quickbooksReady, hasEstimate }: { jobId: string; invoices: InvoiceRow[]; isAdmin: boolean; quickbooksReady: boolean; hasEstimate: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);
  const live = invoices.filter((i) => i.status !== "void");
  const anySent = live.some((i) => i.status !== "draft");

  const act = (work: () => Promise<ActionResult>, done: string) =>
    startTransition(async () => {
      const result = await work();
      setConfirm(null);
      if (result.ok) toast.success(done);
      else toast.error(result.error.message);
    });

  return (
    <div className="space-y-3">
      {live.length === 0 ? (
        <p className="text-muted-foreground">{hasEstimate ? "No invoices. Regenerate them from the accepted estimate." : "No invoices. They are created from the accepted estimate when a deal is won."}</p>
      ) : (
        <ul className="space-y-2">
          {live.map((invoice) => {
            const inQuickBooks = Boolean(invoice.qboNumber) || invoice.sync === "pending";
            return (
              <li key={invoice.id} aria-label={invoice.label} className="space-y-2 rounded-md border bg-card p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    <span className="tabular">{invoice.label}</span> · {invoice.kind === "deposit" ? "Deposit" : "Final"}
                  </p>
                  <span className={cn("inline-flex h-5 items-center rounded px-1.5 text-xs font-medium", STATUS_TONE[invoice.status])}>{STATUS_LABELS[invoice.status]}</span>
                </div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 tabular">
                  <dt className="text-muted-foreground">Total</dt>
                  <dd>{invoice.total}</dd>
                  {invoice.status !== "draft" ? (
                    <>
                      <dt className="text-muted-foreground">Paid</dt>
                      <dd>{invoice.paid}</dd>
                    </>
                  ) : null}
                  {invoice.dueOn && !(isAdmin && invoice.status === "draft") ? (
                    <>
                      <dt className="text-muted-foreground">Due</dt>
                      <dd>{invoice.dueOn}</dd>
                    </>
                  ) : null}
                  {invoice.sync !== "not_synced" ? (
                    <>
                      <dt className="text-muted-foreground">QuickBooks</dt>
                      <dd className={invoice.sync === "error" ? "text-destructive" : undefined}>
                        {invoice.sync === "synced" ? `Synced${invoice.qboNumber ? ` · #${invoice.qboNumber}` : ""}` : invoice.sync === "pending" ? "Sending…" : "Failed"}
                      </dd>
                    </>
                  ) : null}
                </dl>
                {invoice.syncError ? <p className={invoice.sync === "error" ? "text-destructive" : "text-warning"}>{invoice.syncError}</p> : null}

                {isAdmin && invoice.status === "draft" && !inQuickBooks ? (
                  <div className="space-y-2 border-t pt-2">
                    <label className="flex items-center gap-2">
                      <span className="shrink-0 text-muted-foreground">Due date</span>
                      <Input
                        type="date"
                        defaultValue={invoice.dueOn}
                        disabled={pending}
                        aria-label={`Due date for ${invoice.label}`}
                        className="h-11 md:h-8"
                        onChange={(event) => act(() => setInvoiceDueDate({ invoiceId: invoice.id, jobId, dueOn: event.target.value }), "Due date saved")}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {quickbooksReady ? (
                        <Button className="h-11 md:h-8" disabled={pending} onClick={() => act(() => sendInvoiceToQuickBooks({ invoiceId: invoice.id, jobId }), "Sending to QuickBooks")}>
                          Send to QuickBooks
                        </Button>
                      ) : null}
                      <Button variant="outline" className="h-11 md:h-8" disabled={pending} onClick={() => act(() => markInvoiceSent({ invoiceId: invoice.id, jobId }), `${invoice.label} marked sent`)}>
                        Mark sent
                      </Button>
                      {confirm === invoice.id ? (
                        <Button variant="destructive" className="h-11 md:h-8" disabled={pending} onClick={() => act(() => voidInvoice({ invoiceId: invoice.id, jobId }), `${invoice.label} voided`)}>
                          Confirm void
                        </Button>
                      ) : (
                        <Button variant="ghost" className="h-11 text-red-600 md:h-8" disabled={pending} onClick={() => setConfirm(invoice.id)}>
                          Void
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null}

                {isAdmin && !inQuickBooks && (invoice.status === "sent" || invoice.status === "partially_paid" || invoice.status === "paid") ? (
                  <PaymentForm invoice={invoice} disabled={pending} onSave={(amountPaid) => act(() => recordInvoicePayment({ invoiceId: invoice.id, jobId, amountPaid }), "Payment recorded")} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {isAdmin && hasEstimate && !anySent ? (
        confirm === "regenerate" ? (
          <Button variant="destructive" className="h-11 md:h-8" disabled={pending} onClick={() => act(() => regenerateInvoices({ jobId }), "Invoices regenerated")}>
            Confirm: replace the drafts
          </Button>
        ) : (
          <Button variant="outline" className="h-11 md:h-8" disabled={pending} onClick={() => setConfirm("regenerate")}>
            Regenerate from estimate
          </Button>
        )
      ) : null}
      {isAdmin ? null : live.length > 0 ? <p className="text-xs text-muted-foreground">Only admins can change invoices.</p> : null}
    </div>
  );
}

function PaymentForm({ invoice, disabled, onSave }: { invoice: InvoiceRow; disabled: boolean; onSave: (amountPaid: string) => void }) {
  const [amount, setAmount] = useState(invoice.paidInput);
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(amount);
      }}
    >
      <label className="min-w-0 flex-1 space-y-1">
        <span className="block text-xs text-muted-foreground">Paid so far ($)</span>
        <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label={`Amount paid on ${invoice.label}`} className="h-11 tabular md:h-8" />
      </label>
      <Button type="submit" variant="outline" className="h-11 md:h-8" disabled={disabled}>
        Record payment
      </Button>
    </form>
  );
}
