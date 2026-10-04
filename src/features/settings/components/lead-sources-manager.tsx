"use client";

import { useActionState, useRef } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/shared/field-error";
import { useActionToast } from "@/components/shared/use-action-toast";
import { addLeadSource, updateLeadSource } from "@/features/settings/actions";

type Source = { id: string; name: string; is_active: boolean; sort_order: number };
const PROTECTED = ["Website", "Google Ads"];

export function LeadSourcesManager({ sources }: { sources: Source[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addLeadSource, null);
  useActionToast(state, "Source added", () => formRef.current?.reset());
  const nameError = state?.ok === false ? state.error.fields?.name : undefined;

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-md border bg-card">
        {sources.map((source, index) => (
          <SourceRow key={source.id} source={source} first={index === 0} last={index === sources.length - 1} />
        ))}
      </ul>
      <form ref={formRef} action={action} className="space-y-1.5">
        <div className="flex gap-2">
          <Input name="name" aria-label="New source name" placeholder="Home Show 2027" required className="h-11 md:h-9" />
          <Button type="submit" className="h-11 shrink-0 md:h-9" disabled={pending}>
            Add source
          </Button>
        </div>
        <FieldError message={nameError} />
      </form>
    </div>
  );
}

function SourceRow({ source, first, last }: { source: Source; first: boolean; last: boolean }) {
  const [state, action, pending] = useActionState(updateLeadSource, null);
  useActionToast(state, "Saved");
  const locked = PROTECTED.includes(source.name);

  return (
    <li>
      <form action={action} className="flex items-center gap-1 p-1.5">
        <input type="hidden" name="id" value={source.id} />
        <div className="flex">
          <Button type="submit" name="intent" value="up" variant="ghost" size="icon" disabled={first || pending} aria-label={`Move ${source.name} up`} className="size-11 md:size-8">
            <ArrowUp className="size-4" aria-hidden />
          </Button>
          <Button type="submit" name="intent" value="down" variant="ghost" size="icon" disabled={last || pending} aria-label={`Move ${source.name} down`} className="size-11 md:size-8">
            <ArrowDown className="size-4" aria-hidden />
          </Button>
        </div>
        <p className="min-w-0 flex-1 truncate px-1 font-medium">
          {source.name}
          {source.is_active ? null : (
            <Badge variant="outline" className="ml-2">
              Off
            </Badge>
          )}
        </p>
        {locked ? (
          <span className="px-3 text-xs text-muted-foreground">Used by automatic lead capture</span>
        ) : (
          <Button type="submit" name="intent" value="toggle" variant="outline" disabled={pending} className="h-11 w-24 md:h-8">
            {source.is_active ? "Turn off" : "Turn on"}
          </Button>
        )}
      </form>
    </li>
  );
}
