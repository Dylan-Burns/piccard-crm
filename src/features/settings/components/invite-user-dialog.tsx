"use client";

import { useActionState, useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { inviteUser } from "@/features/settings/actions";
import { ROLE_DESCRIPTIONS } from "@/features/settings/components/role-labels";

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(inviteUser, null);
  useActionToast(state, "Invitation sent", () => setOpen(false));
  const fields = state?.ok === false ? state.error.fields : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 md:h-9">
          <UserPlus className="size-4" aria-hidden />
          Invite user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>They will get an email with a link to set their password.</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Name</Label>
            <Input id="invite-name" name="full_name" required className="h-11 md:h-9" />
            <FieldError message={fields?.full_name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" name="email" type="email" required className="h-11 md:h-9" />
            <FieldError message={fields?.email} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <NativeSelect id="invite-role" name="role" defaultValue="sales">
              {Object.entries(ROLE_DESCRIPTIONS).map(([value, { label, description }]) => (
                <option key={value} value={value}>
                  {label}: {description}
                </option>
              ))}
            </NativeSelect>
            <FieldError message={fields?.role} />
          </div>
          <Button type="submit" className="h-11 w-full md:h-9" disabled={pending}>
            {pending ? "Sending…" : "Send invitation"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
