"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogTriggerSlot } from "@/components/shared/dialog-trigger-slot";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { createTask } from "@/features/tasks/actions";
import type { StaffOption } from "@/lib/settings";

export function AddTaskDialog({
  parent,
  users,
  defaultAssignee,
  defaultDue,
  revalidate,
  trigger,
}: {
  parent: { customer_id?: string; opportunity_id?: string; job_id?: string };
  users: StaffOption[];
  defaultAssignee: string;
  /** datetime-local value in the company timezone, e.g. "2026-10-08T09:00". */
  defaultDue: string;
  revalidate: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setInstance((i) => i + 1);
        setOpen(next);
      }}
    >
      <DialogTriggerSlot>
        {trigger ?? (
          <Button variant="outline" className="h-11 md:h-9">
            <Plus className="size-4" aria-hidden />
            Add task
          </Button>
        )}
      </DialogTriggerSlot>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
        </DialogHeader>
        <Body key={instance} onDone={() => setOpen(false)} {...{ parent, users, defaultAssignee, defaultDue, revalidate }} />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  parent,
  users,
  defaultAssignee,
  defaultDue,
  revalidate,
  onDone,
}: {
  parent: { customer_id?: string; opportunity_id?: string; job_id?: string };
  users: StaffOption[];
  defaultAssignee: string;
  defaultDue: string;
  revalidate: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(createTask, null);
  useActionToast(state, "Task added", onDone);
  const fields = state?.ok === false ? state.error.fields : undefined;

  return (
    <form action={action} className="space-y-4">
      {Object.entries(parent).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
      <input type="hidden" name="revalidate" value={revalidate} />
      <div className="space-y-1.5">
        <Label htmlFor="task-title">What needs doing</Label>
        <Input id="task-title" name="title" required className="h-11 md:h-9" placeholder="Call back about the estimate" />
        <FieldError message={fields?.title} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="task-due">Due</Label>
          <Input id="task-due" name="due_at" type="datetime-local" defaultValue={defaultDue} required className="h-11 md:h-9" />
          <FieldError message={fields?.due_at} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-assignee">Assigned to</Label>
          <NativeSelect id="task-assignee" name="assigned_to" defaultValue={defaultAssignee}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={fields?.assigned_to} />
        </div>
      </div>
      <Button type="submit" className="h-11 w-full md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Add task"}
      </Button>
    </form>
  );
}
