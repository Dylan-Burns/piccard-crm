"use client";

import { useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/components/shared/use-action-toast";
import { addNote } from "@/features/notes/actions";

/**
 * Adds a note to a customer, deal, or job. Staff notes are private to staff unless
 * "Share with crew" is ticked; the checkbox is hidden for field users, whose notes are always shared.
 */
export function NoteComposer({
  parent,
  revalidate,
  showShare,
  autoFocus,
  onSaved,
}: {
  parent: { customer_id?: string; opportunity_id?: string; job_id?: string };
  revalidate: string;
  showShare: boolean;
  autoFocus?: boolean;
  onSaved?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addNote, null);
  useActionToast(state, "Note added", () => {
    formRef.current?.reset();
    onSaved?.();
  });
  const fieldError = state?.ok === false ? state.error.fields?.body : undefined;

  return (
    <form ref={formRef} action={action} className="space-y-2">
      {Object.entries(parent).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
      <input type="hidden" name="revalidate" value={revalidate} />
      <Textarea name="body" rows={2} required aria-label="Add a note" placeholder="Add a note…" autoFocus={autoFocus} />
      {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
      <div className="flex items-center justify-between gap-3">
        {showShare ? (
          <label className="flex min-h-11 items-center gap-2 text-muted-foreground md:min-h-9">
            <input type="checkbox" name="shared_with_crew" className="size-4 accent-primary" />
            Share with crew
          </label>
        ) : (
          <span />
        )}
        <Button type="submit" className="h-11 md:h-9" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}
