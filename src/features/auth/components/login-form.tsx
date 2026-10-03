"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/field-error";
import { requestPasswordReset, signIn } from "@/features/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"sign-in" | "reset">("sign-in");
  const [signInState, signInAction, signingIn] = useActionState(signIn, null);
  const [resetState, resetAction, resetting] = useActionState(requestPasswordReset, null);

  if (mode === "reset") {
    return (
      <form action={resetAction} className="space-y-4">
        {resetState?.ok ? (
          <p role="status" className="rounded-md border bg-muted p-3">
            If an account exists for that email, a reset link is on its way.
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="reset-email">Email</Label>
          <Input id="reset-email" name="email" type="email" autoComplete="email" required className="h-11" />
          <FieldError message={resetState?.ok === false ? resetState.error.fields?.email : undefined} />
        </div>
        <Button type="submit" className="h-11 w-full" disabled={resetting}>
          {resetting ? "Sending…" : "Send reset link"}
        </Button>
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={() => setMode("sign-in")}>
          Back to sign in
        </Button>
      </form>
    );
  }

  const error = signInState?.ok === false ? signInState.error : undefined;
  return (
    <form action={signInAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {error && !error.fields ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
          {error.message}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required className="h-11" />
        <FieldError message={error?.fields?.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11" />
        <FieldError message={error?.fields?.password} />
      </div>
      <Button type="submit" className="h-11 w-full" disabled={signingIn}>
        {signingIn ? "Signing in…" : "Sign in"}
      </Button>
      <Button type="button" variant="link" className="w-full" onClick={() => setMode("reset")}>
        Forgot password?
      </Button>
    </form>
  );
}
