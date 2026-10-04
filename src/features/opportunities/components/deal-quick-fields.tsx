"use client";

import { useState, useTransition } from "react";
import { Flag, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { updateDealMeta } from "@/features/opportunities/actions";

const MAX_LABELS = 10;

/**
 * Labels and the expected close date, edited in place in the deal's summary. Each change is
 * saved at once; the shown values follow what the server last confirmed.
 */
export function DealQuickFields({ dealId, labels, expectedCloseOn, suggestions, editable }: { dealId: string; labels: string[]; expectedCloseOn: string | null; suggestions: string[]; editable: boolean }) {
  const [current, setCurrent] = useState(labels);
  const [closeOn, setCloseOn] = useState(expectedCloseOn ?? "");
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  const save = (next: { labels?: string[]; expectedCloseOn?: string | null }, revert: () => void) =>
    startTransition(async () => {
      const result = await updateDealMeta({ id: dealId, ...next });
      if (!result.ok) {
        revert();
        toast.error(result.error.message);
      }
    });

  function setLabels(next: string[]) {
    const previous = current;
    setCurrent(next);
    save({ labels: next }, () => setCurrent(previous));
  }

  function addLabel() {
    const label = draft.trim().slice(0, 30);
    setDraft("");
    if (!label || current.some((l) => l.toLowerCase() === label.toLowerCase()) || current.length >= MAX_LABELS) return;
    setLabels([...current, label]);
  }

  function changeCloseOn(value: string) {
    const previous = closeOn;
    setCloseOn(value);
    save({ expectedCloseOn: value || null }, () => setCloseOn(previous));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Tag className="mt-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          {current.length > 0 ? (
            <ul aria-label="Labels" className="flex flex-wrap gap-1">
              {current.map((label) => (
                <li key={label} className="inline-flex h-6 items-center gap-0.5 rounded bg-primary/10 pl-1.5 text-xs font-medium text-primary">
                  {label}
                  {editable ? (
                    <button type="button" aria-label={`Remove label ${label}`} disabled={pending} onClick={() => setLabels(current.filter((l) => l !== label))} className="flex size-6 items-center justify-center rounded hover:bg-primary/20">
                      <X className="size-3" aria-hidden />
                    </button>
                  ) : (
                    <span className="w-1.5" />
                  )}
                </li>
              ))}
            </ul>
          ) : editable ? null : (
            <p className="text-muted-foreground">No labels</p>
          )}
          {editable && current.length < MAX_LABELS ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addLabel();
              }}
            >
              <Input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={addLabel} maxLength={30} list={`labels-${dealId}`} aria-label="Add a label" placeholder="Add a label…" className="h-11 md:h-8" />
              <datalist id={`labels-${dealId}`}>
                {suggestions
                  .filter((s) => !current.some((l) => l.toLowerCase() === s.toLowerCase()))
                  .map((s) => (
                    <option key={s} value={s} />
                  ))}
              </datalist>
            </form>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Flag className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <label htmlFor={`close-${dealId}`} className="shrink-0 text-muted-foreground">
          Expected close
        </label>
        <Input id={`close-${dealId}`} type="date" value={closeOn} disabled={!editable} onChange={(event) => changeCloseOn(event.target.value)} className="h-11 md:h-8" />
      </div>
    </div>
  );
}
