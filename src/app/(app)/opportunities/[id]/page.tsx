import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MapPin, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddTaskDialog } from "@/components/shared/add-task-dialog";
import { CollapsibleSection } from "@/components/shared/collapsible-section";
import { DealSummaryCard } from "@/components/shared/deal-summary-card";
import { NoteComposer } from "@/components/shared/note-composer";
import { TaskList, type TaskItem } from "@/components/shared/task-list";
import type { TimelineItem } from "@/components/shared/timeline";
import { AppointmentRow } from "@/features/appointments/components/appointment-dialog";
import { ScheduleAppointmentDialog } from "@/features/appointments/components/schedule-appointment-dialog";
import { listAppointments, todayRange } from "@/features/appointments/queries";
import { EstimatesPanel } from "@/features/estimates/components/estimates-panel";
import { CATEGORY_ORDER } from "@/features/files/categories";
import { FileGrid } from "@/features/files/components/file-grid";
import { FileUploader } from "@/features/files/components/file-uploader";
import { listFiles } from "@/features/files/queries";
import { listJobInvoices } from "@/features/jobs/queries";
import { LogContactDialog, LogContactForm } from "@/features/leads/components/log-contact-dialog";
import { OwnerSelect } from "@/features/leads/components/owner-select";
import { listLeadSources } from "@/features/leads/queries";
import { DealEditForm } from "@/features/opportunities/components/deal-edit-form";
import { DealQuickFields } from "@/features/opportunities/components/deal-quick-fields";
import { DealStageControls } from "@/features/opportunities/components/deal-stage-controls";
import { DealWorkspace, type HistoryItem } from "@/features/opportunities/components/deal-workspace";
import { DuplicateBanner } from "@/features/opportunities/components/duplicate-banner";
import { historyKind } from "@/features/opportunities/history";
import { getOpportunityDetail, listDealLabels } from "@/features/opportunities/queries";
import { estimateLabel, summarizeDeal } from "@/features/opportunities/summary";
import { requireRole } from "@/lib/auth";
import { age, dueState, formatDateTime, relativeTime, tomorrowAtNine } from "@/lib/dates";
import { JOB_STATUS_LABELS, LOST_REASON_LABELS } from "@/lib/deal-status";
import { formatCents } from "@/lib/money";
import { formatPhone, telHref } from "@/lib/phone";
import { getTimeZone, listStaffOptions, listUserOptions } from "@/lib/settings";

export const metadata: Metadata = { title: "Deal" };

const dollars = (cents: number | null) => (cents ? (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "");

export default async function OpportunityPage({ params }: PageProps<"/opportunities/[id]">) {
  const me = await requireRole("admin", "sales");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [detail, timeZone, staff, users, sources] = await Promise.all([
    getOpportunityDetail(id),
    getTimeZone(),
    listStaffOptions(),
    listUserOptions(),
    listLeadSources(),
  ]);
  if (!detail) notFound();
  const { deal, activities, notes, tasks, duplicateOf } = detail;
  const [appointments, files, invoices, labelSuggestions] = await Promise.all([
    listAppointments(null, null, timeZone, { opportunityId: deal.id, includeClosed: true }),
    listFiles(me, { opportunityId: deal.id }),
    deal.jobs ? listJobInvoices(deal.jobs.id) : Promise.resolve([]),
    listDealLabels(),
  ]);
  const { today } = todayRange(timeZone);

  const customerName = `${deal.customer.first_name} ${deal.customer.last_name}`.trim();
  const path = `/opportunities/${deal.id}`;
  const property = deal.customer.properties.find((p) => p.id === deal.property_id) ?? null;
  const address = property ? [property.address_line1, property.city].filter(Boolean).join(", ") : null;
  const open = deal.stage !== "won" && deal.stage !== "lost";
  const fullAddress = property ? [property.address_line1, property.city, property.state, property.postal_code].filter(Boolean).join(", ") : "";
  const tel = telHref(deal.customer.phone, deal.customer.phone_e164);
  const lastContact = activities.find((a) => a.type === "call" || a.type === "email" || a.type === "sms") ?? null;
  const movable = {
    id: deal.id,
    customerId: deal.customer_id,
    name: customerName,
    sentEstimates: deal.estimates
      .filter((e) => e.status === "sent" || e.status === "viewed")
      .map((e) => ({ id: e.id, label: estimateLabel(e), total: formatCents(e.total_cents) })),
  };

  const noteById = new Map(notes.map((n) => [n.id, n]));
  const history: HistoryItem[] = activities.map((a) => {
    const meta = (a.metadata ?? {}) as { note_id?: string; notes?: string | null };
    const note = meta.note_id ? noteById.get(meta.note_id) : undefined;
    const item: TimelineItem = { id: a.id, type: a.type, summary: a.summary, detail: note?.body ?? meta.notes ?? null, shared: note?.shared_with_crew ?? false, when: relativeTime(a.occurred_at) };
    return { ...item, kind: historyKind(a.type) };
  });
  const upcoming = appointments.filter((a) => a.status === "scheduled");
  const closedText = <p className="text-muted-foreground">This deal is closed. Reopen it to log more.</p>;
  const taskItems: TaskItem[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    dueLabel: formatDateTime(t.due_at, timeZone),
    dueState: dueState(t.due_at, timeZone),
    assignee: t.assignee?.full_name,
  }));

  return (
    <>
      <header className="space-y-3 border-b px-4 py-4 md:px-6">
        <div>
          <Link href={`/customers/${deal.customer_id}`} className="inline-flex min-h-11 items-center gap-1 text-muted-foreground hover:text-foreground md:min-h-0">
            <ChevronLeft className="size-4" aria-hidden />
            {customerName}
          </Link>
          <h1 className="text-xl font-semibold">{deal.title}</h1>
        </div>
        <DealStageControls deal={movable} stage={deal.stage} staff={staff} users={users} today={today} />
        {deal.stage === "lost" ? (
          <p className="text-muted-foreground">
            Lost: {deal.lost_reason ? LOST_REASON_LABELS[deal.lost_reason] : "no reason"}
            {deal.lost_competitor ? ` (${deal.lost_competitor})` : ""}
            {deal.lost_notes ? `. ${deal.lost_notes}` : ""}
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:p-6">
        {/* Sidebar: what the deal is. On phones it follows the working area. */}
        <div className="order-2 md:order-1">
          <DealSummaryCard deal={summarizeDeal(deal, address, timeZone)} />
          <section aria-label="Labels and close date" className="mt-3 border-b pb-3">
            <DealQuickFields dealId={deal.id} labels={deal.labels} expectedCloseOn={deal.expected_close_on} suggestions={labelSuggestions} editable />
          </section>
          <div className="mt-1">
            <CollapsibleSection title="Customer">
              <p>
                <Link href={`/customers/${deal.customer_id}`} className="font-medium text-primary hover:underline">
                  {customerName}
                </Link>
                {deal.customer.company_name ? <span className="text-muted-foreground"> · {deal.customer.company_name}</span> : null}
              </p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                {tel ? (
                  <>
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd>
                      <a href={tel} className="inline-flex min-h-11 items-center text-primary tabular hover:underline md:min-h-0">
                        {formatPhone(deal.customer.phone)}
                      </a>
                    </dd>
                  </>
                ) : null}
                {deal.customer.email ? (
                  <>
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="truncate">
                      <a href={`mailto:${deal.customer.email}`} className="inline-flex min-h-11 items-center text-primary hover:underline md:min-h-0">
                        {deal.customer.email}
                      </a>
                    </dd>
                  </>
                ) : null}
                {deal.customer.preferred_contact ? (
                  <>
                    <dt className="text-muted-foreground">Prefers</dt>
                    <dd className="capitalize">{deal.customer.preferred_contact}</dd>
                  </>
                ) : null}
              </dl>
              {!tel && !deal.customer.email ? <p className="text-muted-foreground">No phone or email on file.</p> : null}
            </CollapsibleSection>

            <CollapsibleSection title="Property">
              {property ? (
                <>
                  <p>{fullAddress}</p>
                  {property.access_notes ? <p className="text-muted-foreground">Access: {property.access_notes}</p> : null}
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline md:min-h-0">
                    <MapPin className="size-4" aria-hidden />
                    Navigate
                  </a>
                </>
              ) : (
                <p className="text-muted-foreground">No property chosen yet. Set one under Details.</p>
              )}
            </CollapsibleSection>

            <CollapsibleSection title="Overview">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Deal age</dt>
                <dd>{age(deal.created_at)}</dd>
                <dt className="text-muted-foreground">In this stage</dt>
                <dd>{age(deal.stage_entered_at)}</dd>
                <dt className="text-muted-foreground">Last contact</dt>
                <dd>{lastContact ? `${lastContact.summary} · ${relativeTime(lastContact.occurred_at)}` : "None logged"}</dd>
                <dt className="text-muted-foreground">Open tasks</dt>
                <dd className="tabular">{tasks.length}</dd>
              </dl>
            </CollapsibleSection>

            <CollapsibleSection title="Source">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Source</dt>
                <dd>{deal.source?.name ?? "Unknown"}</dd>
                {deal.source_detail ? (
                  <>
                    <dt className="text-muted-foreground">Detail</dt>
                    <dd>{deal.source_detail}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Received</dt>
                <dd>{formatDateTime(deal.created_at, timeZone)}</dd>
              </dl>
            </CollapsibleSection>

            {deal.jobs ? (
              <CollapsibleSection title="Job">
                <p>
                  <Link href={`/jobs/${deal.jobs.id}`} className="font-medium text-primary tabular hover:underline">
                    J-{deal.jobs.job_number}
                  </Link>
                  <span className="text-muted-foreground"> · {JOB_STATUS_LABELS[deal.jobs.status]}</span>
                </p>
              </CollapsibleSection>
            ) : null}

            <CollapsibleSection title="Owner">
              <OwnerSelect opportunityId={deal.id} customerId={deal.customer_id} ownerId={deal.owner_id} staff={staff} />
            </CollapsibleSection>

            <CollapsibleSection title="Deal details" defaultOpen={false}>
              <DealEditForm
              deal={{
                id: deal.id,
                title: deal.title,
                work_type: deal.work_type,
                property_id: deal.property_id,
                source_id: deal.source_id,
                estimated_value: dollars(deal.estimated_value_cents),
                description: deal.description,
                is_insurance_claim: deal.is_insurance_claim,
                insurance_carrier: deal.insurance_carrier,
                claim_number: deal.claim_number,
                adjuster_name: deal.adjuster_name,
                adjuster_phone: deal.adjuster_phone,
                deductible: dollars(deal.deductible_cents),
              }}
              properties={deal.customer.properties.map((p) => ({ id: p.id, label: [p.address_line1, p.city].filter(Boolean).join(", ") }))}
              sources={sources.filter((s) => s.is_active || s.id === deal.source_id)}
            />
            </CollapsibleSection>
          </div>
        </div>

        <div className="order-1 min-w-0 space-y-6 md:order-2">
          {duplicateOf && open ? <DuplicateBanner opportunityId={deal.id} customerId={deal.customer_id} other={duplicateOf} /> : null}
          <DealWorkspace
            history={history}
            focus={
              <div className="space-y-3">
                <TaskList tasks={taskItems} revalidate={path} emptyText={open ? "No next step set." : "No open tasks."} />
                {upcoming.length > 0 ? (
                  <ul className="divide-y overflow-hidden rounded-md border">
                    {upcoming.map((item) => (
                      <li key={item.id}>
                        <AppointmentRow item={item} permissions={{ isStaff: true, userId: me.id }} users={users} showDay />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            }
            panels={{
              activity: (
                <div className="space-y-2">
                  <p className="text-muted-foreground">Add a next step, log a contact, or schedule a visit.</p>
                  <div className="flex flex-wrap gap-2">
                    <AddTaskDialog parent={{ opportunity_id: deal.id }} users={users} defaultAssignee={me.id} defaultDue={tomorrowAtNine(timeZone)} revalidate={path} />
                    {open ? <LogContactDialog opportunityId={deal.id} customerId={deal.customer_id} customerName={customerName} /> : null}
                  </div>
                </div>
              ),
              notes: <NoteComposer parent={{ opportunity_id: deal.id }} revalidate={path} showShare />,
              appointments: (
                <section aria-label="Appointments" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold">Appointments</h2>
                    {open ? (
                      <ScheduleAppointmentDialog
                        defaults={{ opportunityId: deal.id, dealLabel: customerName, date: today, assigneeId: deal.owner_id, type: appointments.some((a) => a.type === "inspection" && a.status !== "cancelled" && a.status !== "no_show") ? "other" : "inspection" }}
                        users={users}
                      />
                    ) : null}
                  </div>
                  {appointments.length === 0 ? (
                    <p className="text-muted-foreground">Nothing scheduled.</p>
                  ) : (
                    <ul className="divide-y overflow-hidden rounded-md border">
                      {appointments.map((item) => (
                        <li key={item.id}>
                          <AppointmentRow item={item} permissions={{ isStaff: true, userId: me.id }} users={users} showDay />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ),
              call: open ? <LogContactForm opportunityId={deal.id} customerId={deal.customer_id} fixedType="call" /> : closedText,
              email: open ? <LogContactForm opportunityId={deal.id} customerId={deal.customer_id} fixedType="email" /> : closedText,
              files: (
                <section aria-label="Files" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold">Files</h2>
                    <FileUploader
                      target={{ opportunityId: deal.id }}
                      categories={CATEGORY_ORDER}
                      title="Upload files"
                      description={customerName}
                      trigger={
                        <Button variant="outline" className="h-11 md:h-9">
                          <Upload className="size-4" aria-hidden />
                          Upload
                        </Button>
                      }
                    />
                  </div>
                  <FileGrid files={files} permissions={{ canEdit: true, canDelete: me.role === "admin" }} />
                </section>
              ),
              estimates: (
                <EstimatesPanel
                  opportunityId={deal.id}
                  canCreate={open}
                  estimates={[...deal.estimates]
                    .sort((a, b) => b.estimate_number - a.estimate_number || b.version - a.version)
                    .map((e) => ({ id: e.id, label: estimateLabel(e), title: e.title, status: e.status, total: formatCents(e.total_cents, { alwaysCents: true }) }))}
                />
              ),
              invoices: (
                <section aria-label="Invoices" className="space-y-3">
                  <h2 className="font-semibold">Invoices</h2>
                  {invoices.length === 0 ? (
                    <p className="text-muted-foreground">No invoices. They are created from the accepted estimate when the deal is won.</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {invoices.map((invoice) => (
                        <li key={invoice.id} className="flex min-h-10 items-center justify-between gap-3 px-3 py-1.5">
                          <span>
                            <span className="tabular">INV-{invoice.invoice_number}</span> · {invoice.kind === "deposit" ? "Deposit" : "Final"}
                            <span className="text-muted-foreground capitalize"> · {invoice.status.replace("_", " ")}</span>
                          </span>
                          <span className="tabular">{formatCents(invoice.total_cents, { alwaysCents: true })}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ),
            }}
          />
        </div>
      </div>
    </>
  );
}
