"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { confirmEmailLink } from "@/features/auth/actions";

export function ConfirmLinkForm(props: { tokenHash: string; type: string; code: string; next: string }) {
  const [state, action, pending] = useActionState(confirmEmailLink, null);
  const error = state?.ok === false ? state.error : undefined;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token_hash" value={props.tokenHash} />
      <input type="hidden" name="type" value={props.type} />
      <input type="hidden" name="code" value={props.code} />
      <input type="hidden" name="next" value={props.next} />
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
          {error.message}
        </p>
      ) : null}
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
      {error ? (
        <Button asChild variant="ghost" className="h-11 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      ) : null}
    </form>
  );
}
