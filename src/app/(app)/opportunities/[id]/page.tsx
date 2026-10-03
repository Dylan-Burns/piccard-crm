import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AddTaskDialog } from "@/components/shared/add-task-dialog";
import { DealSummaryCard } from "@/components/shared/deal-summary-card";
import { NoteComposer } from "@/components/shared/note-composer";
import { TaskList, type TaskItem } from "@/components/shared/task-list";
import { Timeline, type TimelineItem } from "@/components/shared/timeline";
import { LogContactDialog } from "@/features/leads/components/log-contact-dialog";
import { OwnerSelect } from "@/features/leads/components/owner-select";
import { listLeadSources } from "@/features/leads/queries";
import { DealEditForm } from "@/features/opportunities/components/deal-edit-form";
import { DealStageControls } from "@/features/opportunities/components/deal-stage-controls";
import { DuplicateBanner } from "@/features/opportunities/components/duplicate-banner";
import { getOpportunityDetail } from "@/features/opportunities/queries";
import { estimateLabel, summarizeDeal } from "@/features/opportunities/summary";
import { requireRole } from "@/lib/auth";
import { dueState, formatDateTime, relativeTime, tomorrowAtNine } from "@/lib/dates";
import { LOST_REASON_LABELS } from "@/lib/deal-status";
import { formatCents } from "@/lib/money";
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

  const customerName = `${deal.customer.first_name} ${deal.customer.last_name}`.trim();
  const path = `/opportunities/${deal.id}`;
  const property = deal.customer.properties.find((p) => p.id === deal.property_id) ?? null;
  const address = property ? [property.address_line1, property.city].filter(Boolean).join(", ") : null;
  const open = deal.stage !== "won" && deal.stage !== "lost";
  const movable = {
    id: deal.id,
    customerId: deal.customer_id,
    name: customerName,
    sentEstimates: deal.estimates
      .filter((e) => e.status === "sent" || e.status === "viewed")
      .map((e) => ({ id: e.id, label: estimateLabel(e), total: formatCents(e.total_cents) })),
  };

  const noteById = new Map(notes.map((n) => [n.id, n]));
  const timeline: TimelineItem[] = activities.map((a) => {
    const meta = (a.metadata ?? {}) as { note_id?: string; notes?: string | null };
    const note = meta.note_id ? noteById.get(meta.note_id) : undefined;
    return { id: a.id, type: a.type, summary: a.summary, detail: note?.body ?? meta.notes ?? null, shared: note?.shared_with_crew ?? false, when: relativeTime(a.occurred_at) };
  });
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
        <DealStageControls deal={movable} stage={deal.stage} staff={staff} />
        {deal.stage === "lost" ? (
          <p className="text-muted-foreground">
            Lost: {deal.lost_reason ? LOST_REASON_LABELS[deal.lost_reason] : "no reason"}
            {deal.lost_competitor ? ` (${deal.lost_competitor})` : ""}
            {deal.lost_notes ? `. ${deal.lost_notes}` : ""}
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:p-6">
        <div className="space-y-6">
          {duplicateOf && open ? <DuplicateBanner opportunityId={deal.id} customerId={deal.customer_id} other={duplicateOf} /> : null}
          <DealSummaryCard
            deal={summarizeDeal(deal, address, timeZone)}
            actions={open ? <LogContactDialog opportunityId={deal.id} customerId={deal.customer_id} customerName={customerName} /> : null}
          />
          <section aria-label="Timeline" className="space-y-4">
            <NoteComposer parent={{ opportunity_id: deal.id }} revalidate={path} showShare />
            <Timeline items={timeline} />
          </section>
        </div>

        <div className="space-y-6">
          <section aria-label="Tasks" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Next steps</h2>
              <AddTaskDialog parent={{ opportunity_id: deal.id }} users={users} defaultAssignee={me.id} defaultDue={tomorrowAtNine(timeZone)} revalidate={path} />
            </div>
            <TaskList tasks={taskItems} revalidate={path} emptyText={open ? "No next step set." : "No open tasks."} />
          </section>

          <section aria-label="Owner" className="space-y-2">
            <h2 className="font-semibold">Owner</h2>
            <OwnerSelect opportunityId={deal.id} customerId={deal.customer_id} ownerId={deal.owner_id} staff={staff} />
          </section>

          <section aria-label="Deal details" className="space-y-3">
            <h2 className="font-semibold">Deal details</h2>
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
          </section>

          {/* Appointments (phase 6), files (phase 7), and estimates (phase 9) add their panels here. */}
        </div>
      </div>
    </>
  );
}
