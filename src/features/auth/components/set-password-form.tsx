"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/field-error";
import { setPassword } from "@/features/auth/actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, null);
  const error = state?.ok === false ? state.error : undefined;

  return (
    <form action={action} className="space-y-4">
      {error && !error.fields ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
          {error.message}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="h-11" />
        <FieldError message={error?.fields?.password} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="h-11" />
        <FieldError message={error?.fields?.confirm} />
      </div>
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
