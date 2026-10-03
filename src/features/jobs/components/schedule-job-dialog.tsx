"use client";

import { useState, useTransition } from "react";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { scheduleJob } from "@/features/jobs/actions";
import { addDays, formatDay } from "@/lib/dates";
import type { StaffOption } from "@/lib/settings";

const MAX_DAYS = 60;

/** Every yyyy-MM-dd from start to end inclusive (capped). */
function daysBetween(start: string, end: string) {
  const days: string[] = [];
  for (let day = start; day <= end && days.length < MAX_DAYS; day = addDays(day, 1)) days.push(day);
  return days;
}
const isWeekday = (day: string) => ![0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());

export type ScheduleDefaults = { start: string; end: string; days: string[]; assignees: string[] };

/** Date range, work days, and crew for a job. Saving replaces the work days that have not happened yet. */
export function ScheduleJobDialog({ jobId, jobLabel, users, defaults, rescheduling }: { jobId: string; jobLabel: string; users: StaffOption[]; defaults: ScheduleDefaults; rescheduling: boolean }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [days, setDays] = useState(() => new Set(defaults.days));
  const [assignees, setAssignees] = useState(() => new Set(defaults.assignees));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const range = start && end && end >= start ? daysBetween(start, end) : [];

  // Changing the range starts again from weekdays; individual days can then be toggled.
  function changeRange(nextStart: string, nextEnd: string) {
    const fixedEnd = nextEnd < nextStart ? nextStart : nextEnd;
    setStart(nextStart);
    setEnd(fixedEnd);
    const all = nextStart ? daysBetween(nextStart, fixedEnd) : [];
    const weekdays = all.filter(isWeekday);
    setDays(new Set(weekdays.length > 0 ? weekdays : all));
  }
  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (!next.delete(value)) next.add(value);
    return next;
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await scheduleJob({ jobId, start, end, days: range.filter((d) => days.has(d)), assignees: [...assignees] });
      if (result.ok) {
        toast.success(rescheduling ? "Schedule updated" : "Job scheduled");
        setOpen(false);
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={rescheduling ? "outline" : "default"} className="h-11 md:h-9">
          <CalendarDays className="size-4" aria-hidden />
          {rescheduling ? "Change schedule" : "Schedule job"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{rescheduling ? "Change schedule" : "Schedule job"}</DialogTitle>
            <DialogDescription>{jobLabel}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="job-start">Start date</Label>
              <Input id="job-start" type="date" required value={start} onChange={(e) => changeRange(e.target.value, end)} className="h-11 md:h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-end">End date</Label>
              <Input id="job-end" type="date" required min={start} value={end} onChange={(e) => changeRange(start, e.target.value)} className="h-11 md:h-9" />
            </div>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Work days</legend>
            {range.length === 0 ? (
              <p className="text-muted-foreground">Choose the dates first.</p>
            ) : (
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {range.map((day) => (
                  <label key={day} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-2.5 has-checked:border-primary has-checked:bg-primary/10 md:min-h-8">
                    <input type="checkbox" className="size-4 accent-primary" checked={days.has(day)} onChange={() => setDays(toggle(days, day))} />
                    {formatDay(day)}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Crew</legend>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {users.map((user) => (
                <label key={user.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-2.5 has-checked:border-primary has-checked:bg-primary/10 md:min-h-8">
                  <input type="checkbox" className="size-4 accent-primary" checked={assignees.has(user.id)} onChange={() => setAssignees(toggle(assignees, user.id))} />
                  {user.name}
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="h-11 w-full md:h-9" disabled={pending}>
            {rescheduling ? "Save schedule" : "Schedule job"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
