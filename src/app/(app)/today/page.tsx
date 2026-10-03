import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Camera, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskList, type TaskItem } from "@/components/shared/task-list";
import { PageHeader } from "@/components/shell/page-header";
import { AppointmentDialog } from "@/features/appointments/components/appointment-dialog";
import { listAppointments, todayRange } from "@/features/appointments/queries";
import { CATEGORY_ORDER, FIELD_CATEGORIES } from "@/features/files/categories";
import { FileUploader } from "@/features/files/components/file-uploader";
import { listOpenTasks } from "@/features/tasks/queries";
import { requireRole } from "@/lib/auth";
import { dueState, formatDateTime, formatDay } from "@/lib/dates";
import { getTimeZone } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Today" };

/** The phone home screen for field users (spec §5.6). Reads only what the field role can read. */
export default async function TodayPage() {
  const me = await requireRole();
  const timeZone = await getTimeZone();
  const { today, tomorrow } = todayRange(timeZone);
  const supabase = await createClient();
  const [appointments, tasks, jobs] = await Promise.all([
    listAppointments(today, tomorrow, timeZone, { assignee: me.id }),
    listOpenTasks(me.id),
    // RLS returns only jobs this user is assigned to (for field users).
    me.role === "field"
      ? supabase.from("jobs").select("id, job_number, title, status").in("status", ["scheduled", "in_progress"]).order("scheduled_start").limit(20)
      : Promise.resolve({ data: [] as { id: string; job_number: number; title: string; status: string }[] }),
  ]);
  const permissions = { isStaff: me.role !== "field", userId: me.id };
  const taskItems: TaskItem[] = tasks.map((t) => ({ id: t.id, title: t.title, dueLabel: formatDateTime(t.due_at, timeZone), dueState: dueState(t.due_at, timeZone) }));

  return (
    <>
      <PageHeader title="Today" description={formatDay(today, "long")} />
      <div className="space-y-6 p-4 md:max-w-2xl md:p-6">
        <section className="space-y-3" aria-label="Appointments">
          <h2 className="font-semibold">Appointments</h2>
          {appointments.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="Nothing scheduled today" />
          ) : (
            <ul className="space-y-3">
              {appointments.map((item) => (
                <li key={item.id} className="space-y-3 rounded-md border p-3">
                  <div>
                    <p className="text-xs font-medium text-primary tabular">
                      {item.timeLabel} · {item.typeLabel}
                      {item.status === "completed" ? " · Done" : ""}
                    </p>
                    <p className="text-base font-semibold">{item.customerName}</p>
                    {item.address ? <p className="text-muted-foreground">{item.address}</p> : null}
                    {item.accessNotes ? <p className="mt-1">Access: {item.accessNotes}</p> : null}
                    {item.notes ? <p className="mt-1 whitespace-pre-wrap">{item.notes}</p> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {item.mapsUrl ? (
                      <Button asChild variant="outline" className="h-12">
                        <a href={item.mapsUrl} target="_blank" rel="noreferrer">
                          <MapPin className="size-4" aria-hidden />
                          Navigate
                        </a>
                      </Button>
                    ) : null}
                    {item.tel ? (
                      <Button asChild variant="outline" className="h-12">
                        <a href={item.tel}>
                          <Phone className="size-4" aria-hidden />
                          Call
                        </a>
                      </Button>
                    ) : null}
                    <FileUploader
                      target={{ opportunityId: item.opportunityId, appointmentId: item.id }}
                      categories={me.role === "field" ? FIELD_CATEGORIES : CATEGORY_ORDER}
                      description={item.customerName}
                      trigger={
                        <Button variant="outline" className="h-12">
                          <Camera className="size-4" aria-hidden />
                          Add photos
                        </Button>
                      }
                    />
                    <AppointmentDialog
                      item={item}
                      permissions={permissions}
                      users={[]}
                      trigger={<Button className="h-12">{item.status === "scheduled" ? "Mark complete" : "Details"}</Button>}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {jobs.data && jobs.data.length > 0 ? (
          <section className="space-y-3" aria-label="My jobs">
            <h2 className="font-semibold">My jobs</h2>
            <ul className="divide-y rounded-md border">
              {jobs.data.map((job) => (
                <li key={job.id}>
                  <Link href={`/jobs/${job.id}`} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2 hover:bg-muted/50">
                    <span className="min-w-0 truncate font-medium">
                      J-{job.job_number} · {job.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{job.status === "in_progress" ? "In progress" : "Scheduled"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-3" aria-label="My tasks">
          <h2 className="font-semibold">My tasks</h2>
          <TaskList tasks={taskItems} revalidate="/today" emptyText="No open tasks." />
        </section>
      </div>
    </>
  );
}
