"use client";

import { useActionState, useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyLink } from "@/components/shared/copy-link";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { inviteUser } from "@/features/settings/actions";
import { ROLE_DESCRIPTIONS } from "@/features/settings/components/role-labels";

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  // Remount the body on each open so a previous invitation's link is not shown again.
  const [instance, setInstance] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setInstance((i) => i + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-11 md:h-9">
          <UserPlus className="size-4" aria-hidden />
          Invite user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <InviteBody key={instance} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InviteBody({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(inviteUser, null);
  useActionToast(state, "Invitation created");
  const created = state?.ok ? state.data : null;
  const fields = state?.ok === false ? state.error.fields : undefined;

  return (
    <>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Creates the account and a one-time link. Send the link to the person; they use it to set their password.
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3">
            <p>
              Invitation for <span className="font-medium">{created.email}</span>. This link works once and expires in
              24 hours.
            </p>
            <CopyLink link={created.link} label="Invitation link" />
            <Button type="button" variant="outline" className="h-11 w-full md:h-9" onClick={onDone}>
              Done
            </Button>
          </div>
        ) : null}
        <form action={action} className={created ? "hidden" : "space-y-4"}>
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
            {pending ? "Creating…" : "Create invitation"}
          </Button>
        </form>
    </>
  );
}
