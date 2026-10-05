import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, ChevronLeft, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoteComposer } from "@/components/shared/note-composer";
import { Timeline, type TimelineItem } from "@/components/shared/timeline";
import { CATEGORY_ORDER, FIELD_CATEGORIES } from "@/features/files/categories";
import { FileGrid } from "@/features/files/components/file-grid";
import { FileUploader } from "@/features/files/components/file-uploader";
import { listFiles } from "@/features/files/queries";
import { InvoicesPanel } from "@/features/invoices/components/invoices-panel";
import { quickbooksReadyForInvoices } from "@/features/invoices/queries";
import { CrewEditor } from "@/features/jobs/components/crew-panel";
import { JobDetailsForm } from "@/features/jobs/components/job-details-form";
import { JobStatusBadge } from "@/features/jobs/components/job-status-badge";
import { JobStatusControl } from "@/features/jobs/components/job-status-control";
import { ScheduleJobDialog } from "@/features/jobs/components/schedule-job-dialog";
import { getJob, getJobStaffDetail, listJobNotes, scheduleLabel } from "@/features/jobs/queries";
import { PERMIT_STATUS_LABELS } from "@/features/jobs/schemas";
import { todayRange } from "@/features/appointments/queries";
import { activityActor, activityText } from "@/lib/activity";
import { requireRole } from "@/lib/auth";
import { businessDate, formatDate, formatDay, relativeTime } from "@/lib/dates";
import { WORK_TYPE_LABELS } from "@/lib/deal-status";
import { formatCents } from "@/lib/money";
import { formatPhone, telHref } from "@/lib/phone";
import { getTimeZone, listUserOptions } from "@/lib/settings";

export const metadata: Metadata = { title: "Job" };


/**
 * Job record (spec §5.6). Field users see scope, schedule, crew, permit, files, and notes; the
 * staff-only block (contract amount, invoices, timeline) is not queried for them at all.
 */
export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const me = await requireRole();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const isStaff = me.role !== "field";
  const [job, timeZone] = await Promise.all([getJob(id), getTimeZone()]);
  if (!job) notFound();

  // Whether "Send to QuickBooks" is offered: only admins send, so only they are asked.
  const quickbooksReady = me.role === "admin" ? await quickbooksReadyForInvoices() : false;
  const [files, notes, users, staff] = await Promise.all([
    listFiles(me, { opportunityId: job.opportunity_id }),
    listJobNotes(job.opportunity_id),
    isStaff ? listUserOptions() : Promise.resolve([]),
    isStaff ? getJobStaffDetail(job.id, job.opportunity_id) : Promise.resolve(null),
  ]);

  const number = `J-${job.job_number}`;
  const customerName = `${job.customer.first_name} ${job.customer.last_name}`.trim();
  const label = `${number} · ${customerName}`;
  const path = `/jobs/${job.id}`;
  const tel = telHref(job.customer.phone, job.customer.phone_e164);
  const maps = job.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}` : null;
  const { today } = todayRange(timeZone);

  const crew = job.job_assignments.flatMap((a) => (a.user ? [{ id: a.user_id, name: a.user.full_name }] : [])).sort((a, b) => a.name.localeCompare(b.name));
  // Work days, one line per day with the people on it. Field users see only their own days (RLS).
  const workDays = new Map<string, { names: string[]; cancelled: boolean }>();
  for (const a of job.appointments.filter((a) => a.type === "job_work" && a.status !== "cancelled").sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const day = businessDate(a.starts_at, timeZone);
    const entry = workDays.get(day) ?? { names: [], cancelled: false };
    if (a.assignee) entry.names.push(a.assignee.full_name);
    workDays.set(day, entry);
  }
  const upcoming = [...workDays.keys()].filter((day) => day >= today);
  const scheduleDefaults = {
    start: job.scheduled_start && job.scheduled_start >= today ? job.scheduled_start : (upcoming[0] ?? job.scheduled_start ?? ""),
    end: job.scheduled_end ?? "",
    days: [...workDays.keys()],
    assignees: crew.map((c) => c.id),
  };
  const open = job.status !== "completed" && job.status !== "cancelled";

  const timelineItems: TimelineItem[] = (staff?.activities ?? []).map((a) => ({ id: a.id, type: a.type, summary: activityText(a), when: relativeTime(a.occurred_at), actor: activityActor(a) }));

  return (
    <>
      <header className="space-y-3 border-b bg-background px-4 py-4 md:px-6">
        <div>
          <Link href="/jobs" className="inline-flex min-h-11 items-center gap-1 text-muted-foreground hover:text-foreground md:min-h-0">
            <ChevronLeft className="size-4" aria-hidden />
            Jobs
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">
              <span className="tabular">{number}</span> · {job.title}
            </h1>
            <JobStatusBadge status={job.status} />
          </div>
          <p className="text-muted-foreground">
            {isStaff ? (
              <Link href={`/customers/${job.customer_id}`} className="text-primary hover:underline">
                {customerName}
              </Link>
            ) : (
              customerName
            )}
            {job.address ? ` · ${job.address}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {maps ? (
            <Button asChild variant="outline" className="h-11 md:h-9">
              <a href={maps} target="_blank" rel="noreferrer">
                <MapPin className="size-4" aria-hidden />
                Navigate
              </a>
            </Button>
          ) : null}
          {tel ? (
            <Button asChild variant="outline" className="h-11 md:h-9">
              <a href={tel}>
                <Phone className="size-4" aria-hidden />
                Call <span className="hidden tabular md:inline">{formatPhone(job.customer.phone)}</span>
              </a>
            </Button>
          ) : null}
        </div>
        <JobStatusControl
          job={{ id: job.id, label, status: job.status, hasDates: Boolean(job.scheduled_start), started: Boolean(job.started_at) }}
          isStaff={isStaff}
          categories={isStaff ? CATEGORY_ORDER : FIELD_CATEGORIES}
        />
      </header>

      <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:p-6">
        <div className="space-y-6">
          <section aria-label="Scope" className="panel space-y-2">
            <h2 className="panel-head font-semibold">Scope</h2>
            <p className="text-xs text-muted-foreground">{WORK_TYPE_LABELS[job.work_type]}</p>
            {job.scope_summary ? <p className="whitespace-pre-wrap">{job.scope_summary}</p> : <p className="text-muted-foreground">No scope written yet.</p>}
            {job.property?.access_notes ? <p>Access: {job.property.access_notes}</p> : null}
          </section>

          <section aria-label="Schedule" className="panel space-y-2">
            <div className="panel-head">
              <h2 className="font-semibold">Schedule</h2>
              {isStaff && open ? <ScheduleJobDialog jobId={job.id} jobLabel={label} users={users} defaults={scheduleDefaults} rescheduling={Boolean(job.scheduled_start)} /> : null}
            </div>
            <p>{scheduleLabel(job.scheduled_start, job.scheduled_end) ?? "Not scheduled yet."}</p>
            {workDays.size > 0 ? (
              <ul className="divide-y rounded-md border bg-card">
                {[...workDays].map(([day, entry]) => (
                  <li key={day} className="flex min-h-10 items-center justify-between gap-3 px-3 py-1.5">
                    <span className="tabular">{formatDay(day, "long")}</span>
                    <span className="truncate text-muted-foreground">{entry.names.join(", ")}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {job.started_at ? <p className="text-muted-foreground">Started {formatDate(job.started_at, timeZone)}</p> : null}
            {job.completed_at ? <p className="text-muted-foreground">Completed {formatDate(job.completed_at, timeZone)}</p> : null}
          </section>

          <section aria-label="Files" className="panel space-y-3">
            <div className="panel-head">
              <h2 className="font-semibold">Files</h2>
              <FileUploader
                target={{ jobId: job.id }}
                categories={isStaff ? CATEGORY_ORDER : FIELD_CATEGORIES}
                description={label}
                trigger={
                  <Button variant="outline" className="h-11 md:h-9">
                    <Camera className="size-4" aria-hidden />
                    Add photos
                  </Button>
                }
              />
            </div>
            <FileGrid files={files} permissions={{ canEdit: isStaff, canDelete: me.role === "admin" }} />
          </section>

          <section aria-label="Notes" className="panel space-y-3">
            <h2 className="panel-head font-semibold">Notes</h2>
            <NoteComposer parent={{ job_id: job.id }} revalidate={path} showShare={isStaff} />
            {notes.length === 0 ? (
              <p className="text-muted-foreground">No notes yet.</p>
            ) : (
              <ul className="divide-y rounded-md border bg-card">
                {notes.map((note) => (
                  <li key={note.id} className="space-y-0.5 p-3">
                    <p className="whitespace-pre-wrap">{note.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {note.author?.full_name ?? "Customer"} · {relativeTime(note.created_at)}
                      {isStaff && note.shared_with_crew ? " · Shared with crew" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {staff ? (
            <section aria-label="Timeline" className="panel space-y-3">
              <h2 className="panel-head font-semibold">Timeline</h2>
              <Timeline items={timelineItems} />
            </section>
          ) : null}
        </div>

        <div className="space-y-6">
          <section aria-label="Crew" className="panel space-y-2">
            <h2 className="panel-head font-semibold">Crew</h2>
            {isStaff ? (
              <CrewEditor jobId={job.id} crew={crew} users={users} />
            ) : (
              <ul className="divide-y rounded-md border bg-card">
                {crew.map((member) => (
                  <li key={member.id} className="flex min-h-11 items-center px-3">
                    {member.name}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Permit and warranty" className="panel space-y-2">
            <h2 className="panel-head font-semibold">Permit and warranty</h2>
            {isStaff ? (
              <JobDetailsForm job={{ id: job.id, title: job.title, scope_summary: job.scope_summary, permit_status: job.permit_status, permit_number: job.permit_number, warranty_years: job.warranty_years }} />
            ) : null}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              {isStaff ? null : (
                <>
                  <dt className="text-muted-foreground">Permit</dt>
                  <dd>
                    {PERMIT_STATUS_LABELS[job.permit_status]}
                    {job.permit_number ? ` · ${job.permit_number}` : ""}
                  </dd>
                  <dt className="text-muted-foreground">Warranty</dt>
                  <dd>{job.warranty_years ? `${job.warranty_years} years` : "Not set"}</dd>
                </>
              )}
              {job.warranty_expires_on ? (
                <>
                  <dt className="text-muted-foreground">Warranty until</dt>
                  <dd>{formatDay(job.warranty_expires_on, "long")}</dd>
                </>
              ) : null}
            </dl>
          </section>

          {staff ? (
            <>
              <section aria-label="Contract" className="panel space-y-2">
                <h2 className="panel-head font-semibold">Contract</h2>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="tabular">{staff.amountCents === null ? "Not set" : formatCents(staff.amountCents)}</dd>
                  <dt className="text-muted-foreground">Deal owner</dt>
                  <dd>{staff.owner ?? "Unassigned"}</dd>
                </dl>
                <Link href={`/opportunities/${job.opportunity_id}`} className="inline-flex min-h-11 items-center text-primary hover:underline md:min-h-0">
                  Open deal
                </Link>
              </section>
              <section aria-label="Invoices" className="panel space-y-3">
                <h2 className="panel-head font-semibold">Invoices</h2>
                <InvoicesPanel
                  jobId={job.id}
                  isAdmin={me.role === "admin"}
                  quickbooksReady={quickbooksReady}
                  hasEstimate={Boolean(job.accepted_estimate_id)}
                  invoices={staff.invoices.map((invoice) => ({
                    id: invoice.id,
                    label: `INV-${invoice.invoice_number}`,
                    kind: invoice.kind,
                    status: invoice.status,
                    total: formatCents(invoice.total_cents, { alwaysCents: true }),
                    paid: formatCents(invoice.amount_paid_cents, { alwaysCents: true }),
                    paidInput: (invoice.amount_paid_cents / 100).toFixed(2),
                    dueOn: invoice.due_on ?? "",
                    sync: invoice.qbo_sync_status,
                    syncError: invoice.qbo_sync_error,
                    qboNumber: invoice.qbo_doc_number,
                  }))}
                />
              </section>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
