"use client";

import { useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/field-error";
import { useActionToast } from "@/components/shared/use-action-toast";
import { changePassword, updateOwnProfile } from "@/features/settings/actions";

export function ProfileForm({ fullName, phone, email }: { fullName: string; phone: string; email: string }) {
  const [state, action, pending] = useActionState(updateOwnProfile, null);
  useActionToast(state, "Profile saved");
  const fields = state?.ok === false ? state.error.fields : undefined;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} disabled className="h-11 md:h-9" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Name</Label>
        <Input id="full_name" name="full_name" defaultValue={fullName} required className="h-11 md:h-9" />
        <FieldError message={fields?.full_name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" type="tel" defaultValue={phone} autoComplete="tel" className="h-11 md:h-9" />
        <FieldError message={fields?.phone} />
      </div>
      <Button type="submit" className="h-11 md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(changePassword, null);
  useActionToast(state, "Password changed", () => formRef.current?.reset());
  const fields = state?.ok === false ? state.error.fields : undefined;

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="current_password">Current password</Label>
        <Input id="current_password" name="current_password" type="password" autoComplete="current-password" required className="h-11 md:h-9" />
        <FieldError message={fields?.current_password} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required className="h-11 md:h-9" />
        <FieldError message={fields?.password} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="h-11 md:h-9" />
        <FieldError message={fields?.confirm} />
      </div>
      <Button type="submit" variant="outline" className="h-11 md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
