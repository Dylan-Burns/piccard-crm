"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { markLost, markWon, moveStage } from "@/features/pipeline/actions";
import { LOST_REASON_LABELS, STAGE_LABELS, WORK_TYPE_LABELS, OPEN_STAGES } from "@/lib/deal-status";
import type { StaffOption } from "@/lib/settings";

export type OpenStage = (typeof OPEN_STAGES)[number];
export type MoveTarget = OpenStage | "won" | "lost";

/** The slice of a deal the move dialogs need. */
export type MovableDeal = {
  id: string;
  customerId: string;
  name: string;
  sentEstimates: { id: string; label: string; total: string }[];
};

type DialogState =
  | { kind: "gate"; deal: MovableDeal; toStage: OpenStage; missing: string[] }
  | { kind: "won"; deal: MovableDeal }
  | { kind: "lost"; deal: MovableDeal }
  | null;

/**
 * Shared move logic for the board and the deal page. `move` tries the transition and opens the
 * right dialog when more is needed (spec §5.5). `onOptimistic` lets the board show the card in its
 * new column while the request runs.
 */
export function useDealMoves({ staff, onOptimistic }: { staff: StaffOption[]; onOptimistic?: (dealId: string, stage: MoveTarget) => void }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pending, startTransition] = useTransition();

  function move(deal: MovableDeal, target: MoveTarget) {
    if (target === "won") return setDialog({ kind: "won", deal });
    if (target === "lost") return setDialog({ kind: "lost", deal });
    startTransition(async () => {
      onOptimistic?.(deal.id, target);
      const result = await moveStage({ opportunityId: deal.id, customerId: deal.customerId, toStage: target });
      if (result.ok) return;
      if (result.error.code === "missing_requirements") {
        setDialog({ kind: "gate", deal, toStage: target, missing: Object.keys(result.error.fields ?? {}) });
      } else {
        toast.error(result.error.message);
      }
    });
  }

  const close = () => setDialog(null);
  const dialogs = (
    <>
      <Dialog open={dialog?.kind === "gate"} onOpenChange={(open) => !open && close()}>
        <DialogContent>{dialog?.kind === "gate" ? <GateForm {...dialog} staff={staff} onDone={close} /> : null}</DialogContent>
      </Dialog>
      <Dialog open={dialog?.kind === "won"} onOpenChange={(open) => !open && close()}>
        <DialogContent>{dialog?.kind === "won" ? <WonForm deal={dialog.deal} onDone={close} /> : null}</DialogContent>
      </Dialog>
      <Dialog open={dialog?.kind === "lost"} onOpenChange={(open) => !open && close()}>
        <DialogContent>{dialog?.kind === "lost" ? <LostForm deal={dialog.deal} onDone={close} /> : null}</DialogContent>
      </Dialog>
    </>
  );

  return { move, dialogs, pending };
}

/** Asks only for what the destination stage still needs, then retries the move in one call. */
function GateForm({ deal, toStage, missing, staff, onDone }: { deal: MovableDeal; toStage: OpenStage; missing: string[]; staff: StaffOption[]; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [stillMissing, setStillMissing] = useState(missing);
  const needs = (name: string) => stillMissing.includes(name);
  const fillable = stillMissing.some((m) => ["owner", "work_type", "property", "contact"].includes(m));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fill = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    startTransition(async () => {
      const result = await moveStage({ opportunityId: deal.id, customerId: deal.customerId, toStage, fill });
      if (result.ok) {
        toast.success(`Moved to ${STAGE_LABELS[toStage]}`);
        onDone();
      } else if (result.error.code === "missing_requirements") {
        setStillMissing(Object.keys(result.error.fields ?? {}));
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Before moving to {STAGE_LABELS[toStage]}</DialogTitle>
        <DialogDescription>{deal.name}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {needs("owner") ? (
          <div className="space-y-1.5">
            <Label htmlFor="gate-owner">Owner</Label>
            <NativeSelect id="gate-owner" name="owner_id" required defaultValue="">
              <option value="" disabled>
                Choose who owns this deal
              </option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {needs("work_type") ? (
          <div className="space-y-1.5">
            <Label htmlFor="gate-work">Type of work</Label>
            <NativeSelect id="gate-work" name="work_type" required defaultValue="">
              <option value="" disabled>
                Choose the type of work
              </option>
              {Object.entries(WORK_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {needs("property") ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Property address</legend>
            <Input name="address_line1" aria-label="Street address" placeholder="Street address" required className="h-11 md:h-9" />
            <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_6rem] gap-2">
              <Input name="city" aria-label="City" placeholder="City" className="h-11 md:h-9" />
              <Input name="state" aria-label="State" placeholder="State" className="h-11 md:h-9" />
              <Input name="postal_code" aria-label="ZIP" placeholder="ZIP" inputMode="numeric" className="h-11 md:h-9" />
            </div>
          </fieldset>
        ) : null}
        {needs("contact") ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">A phone number or email</legend>
            <Input name="phone" type="tel" aria-label="Phone" placeholder="Phone" className="h-11 md:h-9" />
            <Input name="email" type="email" aria-label="Email" placeholder="Email" className="h-11 md:h-9" />
          </fieldset>
        ) : null}
        {needs("inspection") ? (
          <p className="rounded-md border bg-muted p-3">This stage needs a scheduled inspection. Schedule one from the deal page, and the deal moves here automatically.</p>
        ) : null}
        {needs("estimate") ? (
          <p className="rounded-md border bg-muted p-3">This stage needs an estimate that has been sent. Sending one from the deal page moves the deal here automatically.</p>
        ) : null}
        <div className="flex gap-2">
          {fillable ? (
            <Button type="submit" className="h-11 flex-1 md:h-9" disabled={pending}>
              {pending ? "Saving…" : "Save and move"}
            </Button>
          ) : (
            <Button asChild className="h-11 flex-1 md:h-9">
              <Link href={`/opportunities/${deal.id}`}>Open deal</Link>
            </Button>
          )}
          <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}

function WonForm({ deal, onDone }: { deal: MovableDeal; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; missing?: string[]; amount?: string } | null>(null);
  const hasEstimates = deal.sentEstimates.length > 0;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await markWon({
        opportunityId: deal.id,
        customerId: deal.customerId,
        estimateId: hasEstimates ? String(form.get("estimate_id") ?? "") || null : null,
        amount: String(form.get("amount") ?? ""),
      });
      if (result.ok) {
        toast.success(`Deal won. Job J-${result.data.jobNumber} created.`);
        onDone();
      } else if (result.error.code === "missing_requirements") {
        setError({ message: "Fill in the deal's owner, work type, address, and a phone or email before marking it won.", missing: Object.keys(result.error.fields ?? {}) });
      } else {
        setError({ message: result.error.message, amount: result.error.fields?.amount });
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Mark as won</DialogTitle>
        <DialogDescription>{deal.name}. This creates the job.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {hasEstimates ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Which estimate did the customer accept?</legend>
            {deal.sentEstimates.map((estimate, index) => (
              <label key={estimate.id} className="flex min-h-11 items-center gap-3 rounded-md border px-3">
                <input type="radio" name="estimate_id" value={estimate.id} defaultChecked={index === 0} className="size-4 accent-primary" />
                <span className="flex-1">{estimate.label}</span>
                <span className="font-medium tabular">{estimate.total}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="won-amount">Contract amount</Label>
            <Input id="won-amount" name="amount" inputMode="decimal" placeholder="24,800" required className="h-11 md:h-9" />
            <FieldError message={error?.amount} />
          </div>
        )}
        {error && !error.amount ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            {error.message}{" "}
            {error.missing ? (
              <Link href={`/opportunities/${deal.id}`} className="underline">
                Open deal
              </Link>
            ) : null}
          </p>
        ) : null}
        <Button type="submit" className="h-11 w-full md:h-9" disabled={pending}>
          {pending ? "Saving…" : "Mark won and create job"}
        </Button>
      </form>
    </>
  );
}

function LostForm({ deal, onDone }: { deal: MovableDeal; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await markLost({
        opportunityId: deal.id,
        customerId: deal.customerId,
        reason: String(form.get("reason") ?? "") as never,
        notes: String(form.get("notes") ?? ""),
        competitor: String(form.get("competitor") ?? ""),
      });
      if (result.ok) {
        toast.success("Deal marked lost");
        onDone();
      } else if (result.error.fields) {
        setErrors(result.error.fields);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Mark as lost</DialogTitle>
        <DialogDescription>{deal.name}. Open tasks and appointments on this deal are cancelled.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="lost-reason">Reason</Label>
          <NativeSelect id="lost-reason" name="reason" required value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="" disabled>
              Choose a reason
            </option>
            {Object.entries(LOST_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.reason} />
        </div>
        {reason === "competitor" ? (
          <div className="space-y-1.5">
            <Label htmlFor="lost-competitor">Competitor (optional)</Label>
            <Input id="lost-competitor" name="competitor" className="h-11 md:h-9" />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="lost-notes">Notes{reason === "other" ? "" : " (optional)"}</Label>
          <Textarea id="lost-notes" name="notes" rows={3} required={reason === "other"} />
          <FieldError message={errors.notes} />
        </div>
        <Button type="submit" variant="destructive" className="h-11 w-full md:h-9" disabled={pending}>
          {pending ? "Saving…" : "Mark lost"}
        </Button>
      </form>
    </>
  );
}
