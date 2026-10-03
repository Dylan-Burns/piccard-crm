"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogTriggerSlot } from "@/components/shared/dialog-trigger-slot";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { scheduleAppointment } from "@/features/appointments/actions";
import type { StaffOption } from "@/lib/settings";

const TYPES = [
  { value: "inspection", label: "Inspection" },
  { value: "estimate_presentation", label: "Estimate review" },
  { value: "other", label: "Other" },
] as const;
const DURATIONS = [30, 60, 90, 120, 180, 240];

export type ScheduleDefaults = {
  /** Fixed deal; when omitted the dialog shows a deal picker built from `deals`. */
  opportunityId?: string;
  dealLabel?: string;
  type?: (typeof TYPES)[number]["value"];
  date: string;
  assigneeId?: string | null;
};

export function ScheduleAppointmentDialog({
  defaults,
  users,
  deals,
  trigger,
  onScheduled,
  controlled,
}: {
  defaults: ScheduleDefaults;
  users: StaffOption[];
  deals?: { id: string; label: string; ownerId: string | null }[];
  trigger?: React.ReactNode;
  onScheduled?: () => void;
  /** When given, the parent owns the open state and no trigger button is rendered. */
  controlled?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlled ? controlled.open : localOpen;
  const setOpen = controlled ? controlled.onOpenChange : setLocalOpen;
  const [instance, setInstance] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setInstance((i) => i + 1);
        setOpen(next);
      }}
    >
      {controlled ? null : (
        <DialogTriggerSlot>
          {trigger ?? (
            <Button variant="outline" className="h-11 md:h-9">
              <CalendarPlus className="size-4" aria-hidden />
              Schedule
            </Button>
          )}
        </DialogTriggerSlot>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule appointment</DialogTitle>
          {defaults.dealLabel ? <DialogDescription>{defaults.dealLabel}</DialogDescription> : null}
        </DialogHeader>
        <ScheduleForm
          key={instance}
          defaults={defaults}
          users={users}
          deals={deals}
          onDone={() => {
            setOpen(false);
            onScheduled?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({ defaults, users, deals, onDone }: { defaults: ScheduleDefaults; users: StaffOption[]; deals?: { id: string; label: string; ownerId: string | null }[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(scheduleAppointment, null);
  useActionToast(state, "Appointment scheduled", onDone);
  const error = state?.ok === false ? state.error : undefined;
  const [dealId, setDealId] = useState(defaults.opportunityId ?? "");
  const missing = error?.code === "missing_requirements";

  return (
    <form action={action} className="space-y-4">
      {defaults.opportunityId ? (
        <input type="hidden" name="opportunity_id" value={defaults.opportunityId} />
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="appt-deal">Deal</Label>
          <NativeSelect id="appt-deal" name="opportunity_id" required value={dealId} onChange={(e) => setDealId(e.target.value)}>
            <option value="" disabled>
              Choose a deal
            </option>
            {(deals ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={error?.fields?.opportunity_id} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="appt-type">Type</Label>
          <NativeSelect id="appt-type" name="type" defaultValue={defaults.type ?? "inspection"}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appt-who">Who is going</Label>
          <NativeSelect id="appt-who" name="assigned_to" defaultValue={defaults.assigneeId ?? users[0]?.id ?? ""}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={error?.fields?.assigned_to} />
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="appt-date">Date</Label>
          <Input id="appt-date" name="date" type="date" defaultValue={defaults.date} required className="h-11 md:h-9" />
          <FieldError message={error?.fields?.date} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appt-time">Start</Label>
          <Input id="appt-time" name="time" type="time" defaultValue="10:00" step={900} required className="h-11 md:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appt-duration">Length</Label>
          <NativeSelect id="appt-duration" name="duration" defaultValue="60">
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60} hr`}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="appt-notes">Notes (optional)</Label>
        <Textarea id="appt-notes" name="notes" rows={2} placeholder="What to look at, what to bring" />
      </div>
      {error && !error.fields ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
          {error.message}
          {missing && (defaults.opportunityId || dealId) ? (
            <>
              {" "}
              <Link href={`/opportunities/${defaults.opportunityId ?? dealId}`} className="underline">
                Open deal
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <Button type="submit" className="h-11 w-full md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Schedule"}
      </Button>
    </form>
  );
}
