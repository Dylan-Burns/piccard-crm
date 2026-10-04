"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, BookOpen, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { CopyLink } from "@/components/shared/copy-link";
import { FieldError } from "@/components/shared/field-error";
import { resendEstimateEmail, reviseEstimate, saveEstimateLines, sendEstimate, updateEstimate, voidEstimate } from "@/features/estimates/actions";
import type { PriceBookItem } from "@/features/estimates/queries";
import { computeTotals, lineTotalCents } from "@/features/estimates/totals";
import { formatCents, parseDollarsToCents } from "@/lib/money";

type Line = { key: string; name: string; description: string; quantity: string; unit: string; price: string; isTaxable: boolean };

export type BuilderEstimate = {
  id: string;
  opportunityId: string;
  editable: boolean;
  voidable: boolean;
  title: string;
  scopeNotes: string;
  terms: string;
  discountCents: number;
  taxRate: number;
  depositPercent: number;
  validUntil: string;
  /** Stored totals from the database trigger: the truth once saved. */
  stored: { subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; depositCents: number };
  lines: { id: string; name: string; description: string | null; quantity: number; unit: string; unitPriceCents: number; isTaxable: boolean }[];
  /** Sending: the customer's email (null blocks it), and the customer link once it is out. */
  customerEmail: string | null;
  publicUrl: string | null;
  status: "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired" | "void";
};

const dollars = (cents: number) => (cents / 100).toFixed(2);
const money = (cents: number) => formatCents(cents, { alwaysCents: true });
const quantityOf = (line: Line) => (/^\d+(\.\d{1,2})?$/.test(line.quantity.trim()) ? Number(line.quantity) : NaN);
/** Shows 0.0825 as "8.25" without floating-point noise. */
const percentOf = (rate: number) => String(Math.round(rate * 100_000) / 1000);

let nextKey = 0;
const newKey = () => `new-${nextKey++}`;

/**
 * Estimate builder (spec §9 Phase 9, step 4). Totals shown while editing are a live preview from
 * `computeTotals`; saving stores the header and lines, and the database trigger computes the
 * numbers that the PDF and invoices use. Not a draft → read-only.
 */
export function EstimateBuilder({ estimate, priceBook }: { estimate: BuilderEstimate; priceBook: PriceBookItem[] }) {
  const [title, setTitle] = useState(estimate.title);
  const [scopeNotes, setScopeNotes] = useState(estimate.scopeNotes);
  const [terms, setTerms] = useState(estimate.terms);
  const [discount, setDiscount] = useState(dollars(estimate.discountCents));
  const [taxPercent, setTaxPercent] = useState(percentOf(estimate.taxRate));
  const [depositPercent, setDepositPercent] = useState(String(estimate.depositPercent));
  const [validUntil, setValidUntil] = useState(estimate.validUntil);
  const [lines, setLines] = useState<Line[]>(() =>
    estimate.lines.map((l) => ({ key: l.id, name: l.name, description: l.description ?? "", quantity: String(l.quantity), unit: l.unit, price: dollars(l.unitPriceCents), isTaxable: l.isTaxable })),
  );
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bookOpen, setBookOpen] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { editable } = estimate;

  const edit = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
  };
  const changeLines = (next: Line[]) => {
    setLines(next);
    setDirty(true);
  };
  const patchLine = (key: string, patch: Partial<Line>) => changeLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const moveLine = (index: number, delta: number) => {
    const next = [...lines];
    const [line] = next.splice(index, 1);
    next.splice(index + delta, 0, line!);
    changeLines(next);
  };

  const preview = useMemo(
    () =>
      computeTotals({
        lines: lines.map((l) => ({ quantity: Number.isNaN(quantityOf(l)) ? 0 : quantityOf(l), unitPriceCents: parseDollarsToCents(l.price) ?? 0, isTaxable: l.isTaxable })),
        discountCents: parseDollarsToCents(discount) ?? 0,
        taxRate: Number(taxPercent) > 0 ? Math.round(Number(taxPercent) * 1000) / 100_000 : 0,
        depositPercent: Number(depositPercent) || 0,
      }),
    [lines, discount, taxPercent, depositPercent],
  );
  // While nothing has changed, show exactly what the database stored.
  const totals = dirty ? preview : { ...preview, ...estimate.stored };

  function save() {
    const bad = lines.findIndex((l) => !l.name.trim() || Number.isNaN(quantityOf(l)) || quantityOf(l) <= 0 || parseDollarsToCents(l.price) === null);
    if (bad !== -1) {
      setErrors({ lines: `Line ${bad + 1} needs a name, a quantity above zero, and a price.` });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const header = await updateEstimate({ id: estimate.id, title, scope_notes: scopeNotes, terms, discount, tax_percent: taxPercent, deposit_percent: depositPercent, valid_until: validUntil });
      if (!header.ok) {
        setErrors(header.error.fields ?? {});
        toast.error(header.error.message);
        return;
      }
      const saved = await saveEstimateLines({
        estimateId: estimate.id,
        lines: lines.map((l) => ({ name: l.name, description: l.description, quantity: quantityOf(l), unit: l.unit.trim() || "ea", unitPriceCents: parseDollarsToCents(l.price)!, isTaxable: l.isTaxable })),
      });
      if (saved.ok) {
        setDirty(false);
        toast.success("Estimate saved");
      } else {
        toast.error(saved.error.message);
      }
    });
  }

  const doVoid = () =>
    startTransition(async () => {
      const result = await voidEstimate({ estimateId: estimate.id, opportunityId: estimate.opportunityId });
      setConfirmVoid(false);
      if (result.ok) toast.success("Estimate voided");
      else toast.error(result.error.message);
    });

  const doSend = () =>
    startTransition(async () => {
      const result = await sendEstimate({ estimateId: estimate.id, opportunityId: estimate.opportunityId });
      setConfirmSend(false);
      if (!result.ok) toast.error(result.error.message);
      else if (result.data.email === "failed") toast.warning("Estimate sent, but the email did not go out. Resend it or copy the link.");
      else toast.success(`Estimate sent to ${result.data.to}`);
    });

  const doResend = () =>
    startTransition(async () => {
      const result = await resendEstimateEmail({ estimateId: estimate.id });
      if (!result.ok) toast.error(result.error.message);
      else if (result.data.email === "failed") toast.error("The email did not go out. Copy the link instead.");
      else toast.success(`Email sent to ${result.data.to}`);
    });

  const doRevise = () =>
    startTransition(async () => {
      const result = await reviseEstimate({ estimateId: estimate.id, opportunityId: estimate.opportunityId });
      if (result.ok) router.push(`/opportunities/${estimate.opportunityId}/estimates/${result.data.estimateId}`);
      else toast.error(result.error.message);
    });

  const out = estimate.status === "sent" || estimate.status === "viewed";
  const canSend = editable && !dirty && lines.length > 0 && estimate.stored.totalCents > 0;
  const inputClass = "h-11 md:h-9";

  return (
    <div className="grid gap-6 p-4 pb-0 md:grid-cols-[minmax(0,1fr)_18rem] md:p-6">
      <div className="space-y-6">
        <section aria-label="Details" className="panel grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} disabled={!editable} onChange={(e) => edit(setTitle)(e.target.value)} className={inputClass} />
            <FieldError message={errors.title} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="scope_notes">Scope notes (shown above the lines)</Label>
            <Textarea id="scope_notes" rows={3} value={scopeNotes} disabled={!editable} onChange={(e) => edit(setScopeNotes)(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="valid_until">Valid until</Label>
            <Input id="valid_until" type="date" value={validUntil} disabled={!editable} onChange={(e) => edit(setValidUntil)(e.target.value)} className={inputClass} />
          </div>
        </section>

        <section aria-label="Lines" className="panel space-y-3">
          <div className="panel-head flex-wrap">
            <h2 className="font-semibold">Lines</h2>
            {editable ? (
              <div className="flex gap-2">
                <Popover open={bookOpen} onOpenChange={setBookOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="h-11 md:h-9">
                      <BookOpen className="size-4" aria-hidden />
                      From price book
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 p-0">
                    <Command>
                      <CommandInput placeholder="Search the price book…" />
                      <CommandList>
                        <CommandEmpty>Nothing matches.</CommandEmpty>
                        <CommandGroup>
                          {priceBook.map((item) => (
                            <CommandItem
                              key={item.id}
                              value={`${item.name} ${item.description ?? ""}`}
                              onSelect={() => {
                                // Values are copied, so later price-book changes never alter this estimate.
                                changeLines([...lines, { key: newKey(), name: item.name, description: item.description ?? "", quantity: "1", unit: item.unit, price: dollars(item.unit_price_cents), isTaxable: item.is_taxable }]);
                                setBookOpen(false);
                              }}
                            >
                              <span className="min-w-0 flex-1 truncate">{item.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground tabular">
                                ${dollars(item.unit_price_cents)}/{item.unit}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => changeLines([...lines, { key: newKey(), name: "", description: "", quantity: "1", unit: "ea", price: "", isTaxable: true }])}>
                  <Plus className="size-4" aria-hidden />
                  Custom line
                </Button>
              </div>
            ) : null}
          </div>

          {lines.length === 0 ? <p className="text-muted-foreground">No lines yet.</p> : null}
          <ol className="space-y-3 md:space-y-0 md:divide-y md:rounded-md md:border">
            {lines.map((line, index) => {
              const n = index + 1;
              const quantity = quantityOf(line);
              const total = Number.isNaN(quantity) ? null : lineTotalCents({ quantity, unitPriceCents: parseDollarsToCents(line.price) ?? 0 });
              return (
                <li key={line.key} aria-label={`Line ${n}`} className="grid grid-cols-6 gap-2 rounded-md border bg-card p-3 md:grid-cols-[minmax(0,1fr)_4.5rem_4rem_6.5rem_auto_6.5rem_auto] md:items-start md:rounded-none md:border-0">
                  <div className="col-span-6 space-y-1.5 md:col-span-1">
                    <Input aria-label={`Line ${n} name`} placeholder="Item" value={line.name} disabled={!editable} onChange={(e) => patchLine(line.key, { name: e.target.value })} className={inputClass} />
                    <Input aria-label={`Line ${n} description`} placeholder="Description (optional)" value={line.description} disabled={!editable} onChange={(e) => patchLine(line.key, { description: e.target.value })} className="h-11 text-muted-foreground md:h-8" />
                  </div>
                  <Input aria-label={`Line ${n} quantity`} inputMode="decimal" value={line.quantity} disabled={!editable} onChange={(e) => patchLine(line.key, { quantity: e.target.value })} className={`col-span-2 tabular md:col-span-1 ${inputClass}`} />
                  <Input aria-label={`Line ${n} unit`} value={line.unit} disabled={!editable} onChange={(e) => patchLine(line.key, { unit: e.target.value })} className={`col-span-2 md:col-span-1 ${inputClass}`} />
                  <Input aria-label={`Line ${n} unit price`} inputMode="decimal" placeholder="0.00" value={line.price} disabled={!editable} onChange={(e) => patchLine(line.key, { price: e.target.value })} className={`col-span-2 tabular md:col-span-1 ${inputClass}`} />
                  <label className="col-span-3 flex min-h-11 items-center gap-2 md:col-span-1 md:min-h-9">
                    <input type="checkbox" aria-label={`Line ${n} taxable`} checked={line.isTaxable} disabled={!editable} onChange={(e) => patchLine(line.key, { isTaxable: e.target.checked })} className="size-4 accent-primary" />
                    Tax
                  </label>
                  <p aria-label={`Line ${n} total`} className="col-span-3 flex min-h-11 items-center justify-end font-medium tabular md:col-span-1 md:min-h-9">
                    {total === null ? "—" : money(total)}
                  </p>
                  {editable ? (
                    <div className="col-span-6 flex justify-end md:col-span-1">
                      <Button type="button" variant="ghost" size="icon" aria-label={`Move line ${n} up`} disabled={index === 0} className="size-11 md:size-8" onClick={() => moveLine(index, -1)}>
                        <ArrowUp className="size-4" aria-hidden />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Move line ${n} down`} disabled={index === lines.length - 1} className="size-11 md:size-8" onClick={() => moveLine(index, 1)}>
                        <ArrowDown className="size-4" aria-hidden />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${n}`} className="size-11 md:size-8" onClick={() => changeLines(lines.filter((l) => l.key !== line.key))}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {errors.lines ? (
            <p role="alert" className="text-destructive">
              {errors.lines}
            </p>
          ) : null}
        </section>

        <section aria-label="Terms" className="panel space-y-1.5">
          <Label htmlFor="terms">Terms</Label>
          <Textarea id="terms" rows={6} value={terms} disabled={!editable} onChange={(e) => edit(setTerms)(e.target.value)} />
        </section>
      </div>

      {/* Totals: a side panel on desktop, a bar pinned above the tab bar on phones */}
      <aside aria-label="Totals" className="sticky bottom-16 z-10 -mx-4 space-y-3 border-t bg-background p-4 md:static md:mx-0 md:self-start md:rounded-md md:border md:bg-card md:p-3">
        <div className="hidden gap-3 md:grid">
          <TotalsFields discount={discount} taxPercent={taxPercent} depositPercent={depositPercent} editable={editable} errors={errors} onDiscount={edit(setDiscount)} onTax={edit(setTaxPercent)} onDeposit={edit(setDepositPercent)} idPrefix="side" />
        </div>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 tabular">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right">{money(totals.subtotalCents)}</dd>
          {totals.discountCents > 0 ? (
            <>
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="text-right">−{money(totals.discountCents)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Tax</dt>
          <dd className="text-right">{money(totals.taxCents)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold">{money(totals.totalCents)}</dd>
          <dt className="text-muted-foreground">Deposit</dt>
          <dd className="text-right">{money(totals.depositCents)}</dd>
        </dl>
        {editable ? (
          <Button type="button" className="h-11 w-full md:h-9" disabled={pending || !dirty} onClick={save}>
            {dirty ? "Save estimate" : "Saved"}
          </Button>
        ) : null}
        {editable ? (
          estimate.customerEmail ? (
            confirmSend ? (
              <Button type="button" className="h-11 w-full md:h-9" disabled={pending || !canSend} onClick={doSend}>
                Send to {estimate.customerEmail}
              </Button>
            ) : (
              <Button type="button" variant="outline" className="h-11 w-full md:h-9" disabled={pending || !canSend} onClick={() => setConfirmSend(true)}>
                <Send className="size-4" aria-hidden />
                Send to customer
              </Button>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Add the customer&apos;s email to send this estimate.</p>
          )
        ) : null}
        {editable && estimate.customerEmail && dirty ? <p className="text-xs text-muted-foreground">Save before sending.</p> : null}
        {out && estimate.publicUrl ? (
          <div className="space-y-2">
            <CopyLink link={estimate.publicUrl} label="Customer link" />
            <Button type="button" variant="outline" className="h-11 w-full md:h-9" disabled={pending} onClick={doResend}>
              Resend email
            </Button>
          </div>
        ) : null}
        {["sent", "viewed", "declined", "expired", "void"].includes(estimate.status) ? (
          <Button type="button" variant="outline" className="h-11 w-full md:h-9" disabled={pending} onClick={doRevise}>
            Revise
          </Button>
        ) : null}
        {estimate.voidable ? (
          confirmVoid ? (
            <Button type="button" variant="destructive" className="h-11 w-full md:h-9" disabled={pending} onClick={doVoid}>
              Confirm void
            </Button>
          ) : (
            <Button type="button" variant="ghost" className="h-11 w-full text-red-600 md:h-9" onClick={() => setConfirmVoid(true)}>
              Void estimate
            </Button>
          )
        ) : null}
      </aside>

      {/* On phones the three rate fields sit in the page flow, above the pinned totals bar. */}
      <section aria-label="Discount, tax, and deposit" className="panel grid gap-3 md:hidden">
        <TotalsFields discount={discount} taxPercent={taxPercent} depositPercent={depositPercent} editable={editable} errors={errors} onDiscount={edit(setDiscount)} onTax={edit(setTaxPercent)} onDeposit={edit(setDepositPercent)} idPrefix="flow" />
      </section>
    </div>
  );
}

function TotalsFields({
  discount,
  taxPercent,
  depositPercent,
  editable,
  errors,
  onDiscount,
  onTax,
  onDeposit,
  idPrefix,
}: {
  discount: string;
  taxPercent: string;
  depositPercent: string;
  editable: boolean;
  errors: Record<string, string>;
  onDiscount: (v: string) => void;
  onTax: (v: string) => void;
  onDeposit: (v: string) => void;
  idPrefix: string;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-discount`}>Discount ($)</Label>
        <Input id={`${idPrefix}-discount`} inputMode="decimal" value={discount} disabled={!editable} onChange={(e) => onDiscount(e.target.value)} className="h-11 tabular md:h-9" />
        <FieldError message={errors.discount} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-tax`}>Tax rate (%)</Label>
        <Input id={`${idPrefix}-tax`} inputMode="decimal" value={taxPercent} disabled={!editable} onChange={(e) => onTax(e.target.value)} className="h-11 tabular md:h-9" />
        <FieldError message={errors.tax_percent} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-deposit`}>Deposit (%)</Label>
        <Input id={`${idPrefix}-deposit`} inputMode="numeric" value={depositPercent} disabled={!editable} onChange={(e) => onDeposit(e.target.value)} className="h-11 tabular md:h-9" />
        <FieldError message={errors.deposit_percent} />
      </div>
    </>
  );
}
