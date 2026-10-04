"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck2, CalendarX2, MapPin, Phone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogTriggerSlot } from "@/components/shared/dialog-trigger-slot";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { closeAppointment, rescheduleAppointment } from "@/features/appointments/actions";
import type { CalendarItem } from "@/features/appointments/queries";
import type { StaffOption } from "@/lib/settings";
import { cn } from "@/lib/utils";

const STATUS_LABEL = { scheduled: "Scheduled", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" } as const;

/** What the viewer may do: staff manage everything; the assignee can complete or mark no-show. */
export type AppointmentPermissions = { isStaff: boolean; userId: string };

export function AppointmentDialog({
  item,
  permissions,
  users,
  trigger,
}: {
  item: CalendarItem;
  permissions: AppointmentPermissions;
  users: StaffOption[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"view" | "complete" | "reschedule" | "cancel">("view");
  const close = () => {
    setOpen(false);
    setMode("view");
  };
  const canComplete = item.status === "scheduled" && (permissions.isStaff || item.assigneeId === permissions.userId);
  const canManage = item.status === "scheduled" && permissions.isStaff;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTriggerSlot>{trigger}</DialogTriggerSlot>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.title}</DialogTitle>
          <DialogDescription>
            {item.whenLabel} · {item.assignee} · {STATUS_LABEL[item.status]}
          </DialogDescription>
        </DialogHeader>

        {mode === "view" ? (
          <div className="space-y-4">
            <dl className="space-y-2">
              {item.address ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Address</dt>
                  <dd>{item.address}</dd>
                </div>
              ) : null}
              {item.accessNotes ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Access</dt>
                  <dd>{item.accessNotes}</dd>
                </div>
              ) : null}
              {item.notes ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap">{item.notes}</dd>
                </div>
              ) : null}
              {item.outcomeNotes ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Outcome</dt>
                  <dd className="whitespace-pre-wrap">{item.outcomeNotes}</dd>
                </div>
              ) : null}
            </dl>
            <div className="grid grid-cols-2 gap-2">
              {item.tel ? (
                <Button asChild variant="outline" className="h-11">
                  <a href={item.tel}>
                    <Phone className="size-4" aria-hidden />
                    Call
                  </a>
                </Button>
              ) : null}
              {item.mapsUrl ? (
                <Button asChild variant="outline" className="h-11">
                  <a href={item.mapsUrl} target="_blank" rel="noreferrer">
                    <MapPin className="size-4" aria-hidden />
                    Navigate
                  </a>
                </Button>
              ) : null}
            </div>
            {canComplete ? (
              <Button className="h-11 w-full" onClick={() => setMode("complete")}>
                Mark complete
              </Button>
            ) : null}
            {canManage ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setMode("reschedule")}>
                  Reschedule
                </Button>
                <Button variant="outline" className="h-11 text-destructive md:h-9" onClick={() => setMode("cancel")}>
                  Cancel appointment
                </Button>
              </div>
            ) : null}
            {permissions.isStaff ? (
              <Button asChild variant="ghost" className="h-11 w-full md:h-9">
                <Link href={`/opportunities/${item.opportunityId}`}>Open deal</Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        {mode === "complete" ? <CloseForm item={item} kind="complete" onDone={close} onBack={() => setMode("view")} /> : null}
        {mode === "cancel" ? <CloseForm item={item} kind="cancel" onDone={close} onBack={() => setMode("view")} /> : null}
        {mode === "reschedule" ? <RescheduleForm item={item} users={users} onDone={close} onBack={() => setMode("view")} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CloseForm({ item, kind, onDone, onBack }: { item: CalendarItem; kind: "complete" | "cancel"; onDone: () => void; onBack: () => void }) {
  // Closing an appointment can remove this row from the page (a cancelled one drops off the
  // calendar), which unmounts this component before an effect-based toast could fire. So the
  // toast is raised from the submit handler, which finishes regardless.
  const [pending, startTransition] = useTransition();
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? "";
    formData.set("intent", intent);
    startTransition(async () => {
      const result = await closeAppointment(null, formData);
      if (result.ok) {
        toast.success(intent === "cancel" ? "Appointment cancelled" : intent === "no_show" ? "Marked as no-show" : "Appointment completed");
        onDone();
      } else {
        toast.error(result.error.message);
      }
    });
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="appointment_id" value={item.id} />
      <input type="hidden" name="opportunity_id" value={item.opportunityId} />
      <div className="space-y-1.5">
        <Label htmlFor="close-notes">{kind === "cancel" ? "Reason (optional)" : "What did you find? (optional)"}</Label>
        <Textarea id="close-notes" name="notes" rows={3} />
      </div>
      {kind === "complete" ? (
        <div className="grid gap-2">
          <Button type="submit" name="intent" value="completed" className="h-11" disabled={pending}>
            Completed
          </Button>
          <Button type="submit" name="intent" value="no_show" variant="outline" className="h-11" disabled={pending}>
            Customer was not there
          </Button>
        </div>
      ) : (
        <Button type="submit" name="intent" value="cancel" variant="destructive" className="h-11 w-full" disabled={pending}>
          Cancel appointment
        </Button>
      )}
      <Button type="button" variant="ghost" className="h-11 w-full md:h-9" onClick={onBack}>
        Back
      </Button>
    </form>
  );
}

function RescheduleForm({ item, users, onDone, onBack }: { item: CalendarItem; users: StaffOption[]; onDone: () => void; onBack: () => void }) {
  const [state, action, pending] = useActionState(rescheduleAppointment, null);
  useActionToast(state, "Appointment moved", onDone);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="appointment_id" value={item.id} />
      <input type="hidden" name="opportunity_id" value={item.opportunityId} />
      <input type="hidden" name="duration" value={item.durationMinutes} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="move-date">Date</Label>
          <Input id="move-date" name="date" type="date" defaultValue={item.day} required className="h-11 md:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="move-time">Start</Label>
          <Input id="move-time" name="time" type="time" defaultValue={item.timeInput} step={900} required className="h-11 md:h-9" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="move-who">Who is going</Label>
        <NativeSelect id="move-who" name="assigned_to" defaultValue={item.assigneeId}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {state?.ok === false ? <p className="text-destructive">{state.error.message}</p> : null}
      <Button type="submit" className="h-11 w-full md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="ghost" className="h-11 w-full md:h-9" onClick={onBack}>
        Back
      </Button>
    </form>
  );
}

const TYPE_TONE: Record<CalendarItem["type"], string> = {
  inspection: "border-l-primary",
  estimate_presentation: "border-l-warning",
  job_work: "border-l-success",
  other: "border-l-muted-foreground",
};

/** Compact appointment button for calendar grids; opens the details dialog. */
export function AppointmentChip({ item, permissions, users, className }: { item: CalendarItem; permissions: AppointmentPermissions; users: StaffOption[]; className?: string }) {
  return (
    <AppointmentDialog
      item={item}
      permissions={permissions}
      users={users}
      trigger={
        <button
          type="button"
          className={cn(
            "block w-full truncate rounded border border-l-4 bg-background px-1.5 py-1 text-left text-xs hover:bg-muted",
            TYPE_TONE[item.type],
            item.status === "completed" && "text-muted-foreground line-through",
            className,
          )}
        >
          <span className="tabular">{item.allDay ? "" : item.timeLabel.replace(":00", "").replace(" ", "").toLowerCase() + " "}</span>
          {item.customerName}
        </button>
      }
    />
  );
}

/** Full-width row for agenda lists and panels. */
export function AppointmentRow({ item, permissions, users, showDay }: { item: CalendarItem; permissions: AppointmentPermissions; users: StaffOption[]; showDay?: boolean }) {
  return (
    <AppointmentDialog
      item={item}
      permissions={permissions}
      users={users}
      trigger={
        <button type="button" className={cn("flex min-h-14 w-full items-center gap-3 border-l-4 px-3 py-2 text-left hover:bg-muted/50", TYPE_TONE[item.type])}>
          <span className="w-20 shrink-0 text-xs tabular text-muted-foreground">{showDay ? item.whenLabel : item.timeLabel}</span>
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate font-medium", item.status !== "scheduled" && "text-muted-foreground")}>{item.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{[item.address, item.assignee].filter(Boolean).join(" · ")}</span>
          </span>
          <SyncIcon sync={item.sync} error={item.syncError} />
          {item.status !== "scheduled" ? <span className="shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[item.status]}</span> : null}
        </button>
      }
    />
  );
}

/** Google Calendar state for an appointment: on the calendar, waiting, or failed. Nothing when Google is not connected. */
function SyncIcon({ sync, error }: { sync: CalendarItem["sync"]; error: string | null }) {
  if (sync === "not_synced") return null;
  const label = sync === "synced" ? "On Google Calendar" : sync === "pending" ? "Waiting to sync to Google Calendar" : `Google Calendar sync failed${error ? `: ${error}` : ""}`;
  const Icon = sync === "synced" ? CalendarCheck2 : sync === "pending" ? RefreshCw : CalendarX2;
  return (
    <span role="img" aria-label={label} title={label} className={cn("shrink-0", sync === "error" ? "text-destructive" : "text-muted-foreground")}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}
