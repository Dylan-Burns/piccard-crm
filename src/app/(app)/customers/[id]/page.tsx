import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Mail, MapPin, MessageSquare, Pencil, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddTaskDialog } from "@/components/shared/add-task-dialog";
import { DealSummaryCard } from "@/components/shared/deal-summary-card";
import { EmptyState } from "@/components/shared/empty-state";
import { NoteComposer } from "@/components/shared/note-composer";
import { TaskList, type TaskItem } from "@/components/shared/task-list";
import { MilestoneStrip, Timeline, type TimelineItem } from "@/components/shared/timeline";
import { ScheduleAppointmentDialog } from "@/features/appointments/components/schedule-appointment-dialog";
import { todayRange } from "@/features/appointments/queries";
import { EditCustomerDialog, PropertyDialog } from "@/features/customers/components/customer-dialogs";
import { CustomerFab } from "@/features/customers/components/customer-fab";
import { CustomerPanels } from "@/features/customers/components/customer-panels";
import { getCustomerDetail, getDealMilestones, type CustomerDeal } from "@/features/customers/queries";
import { LogContactDialog } from "@/features/leads/components/log-contact-dialog";
import { summarizeDeal } from "@/features/opportunities/summary";
import { requireRole } from "@/lib/auth";
import { dueState, formatDateTime, relativeTime, tomorrowAtNine } from "@/lib/dates";
import { formatPhone, telHref } from "@/lib/phone";
import { getTimeZone, listUserOptions } from "@/lib/settings";

export const metadata: Metadata = { title: "Customer" };

const STAGE_ORDER = { open: 0, won: 1, lost: 2 } as const;
const bucket = (deal: CustomerDeal) => (deal.stage === "won" ? "won" : deal.stage === "lost" ? "lost" : "open");

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const me = await requireRole("admin", "sales");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [detail, timeZone, users] = await Promise.all([getCustomerDetail(id), getTimeZone(), listUserOptions()]);
  if (!detail) notFound();
  const { customer, activities, notes, tasks } = detail;

  const name = `${customer.first_name} ${customer.last_name}`.trim();
  const path = `/customers/${customer.id}`;
  const primaryProperty = customer.properties.find((p) => p.is_primary) ?? customer.properties[0] ?? null;
  const addressOf = (propertyId: string | null) => {
    const p = customer.properties.find((x) => x.id === propertyId) ?? primaryProperty;
    return p ? [p.address_line1, p.city].filter(Boolean).join(", ") : null;
  };
  const fullAddress = primaryProperty
    ? [primaryProperty.address_line1, primaryProperty.city, primaryProperty.state, primaryProperty.postal_code].filter(Boolean).join(", ")
    : null;

  const deals = [...customer.opportunities].sort(
    (a, b) => STAGE_ORDER[bucket(a)] - STAGE_ORDER[bucket(b)] || b.created_at.localeCompare(a.created_at),
  );
  const primaryDeal = deals.find((d) => bucket(d) === "open") ?? null;
  const milestoneTypes = primaryDeal ? await getDealMilestones(primaryDeal.id) : new Set<string>();
  const hasCompletedInspection = primaryDeal?.appointments.some((a) => a.type === "inspection" && a.status === "completed") ?? false;

  const dealTitles = new Map(deals.map((d) => [d.id, d.title]));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const timelineItems: TimelineItem[] = activities.map((a) => {
    const meta = (a.metadata ?? {}) as { note_id?: string; notes?: string | null };
    const note = meta.note_id ? noteById.get(meta.note_id) : undefined;
    return {
      id: a.id,
      type: a.type,
      summary: a.summary,
      detail: note?.body ?? meta.notes ?? null,
      shared: note?.shared_with_crew ?? false,
      when: relativeTime(a.occurred_at),
      dealLabel: deals.length > 1 && a.opportunity_id ? dealTitles.get(a.opportunity_id) : null,
    };
  });

  const taskItems: TaskItem[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    dueLabel: formatDateTime(t.due_at, timeZone),
    dueState: dueState(t.due_at, timeZone),
    assignee: t.assignee?.full_name,
  }));

  const tel = telHref(customer.phone, customer.phone_e164);
  const sms = tel?.replace("tel:", "sms:");
  const maps = fullAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}` : null;
  // Default due time for a new task: tomorrow 9:00 in the company timezone.
  const defaultDue = tomorrowAtNine(timeZone);
  const { today } = todayRange(timeZone);
  const noteParent = primaryDeal ? { opportunity_id: primaryDeal.id } : { customer_id: customer.id };

  return (
    <>
      {/* Header: sticky on phones so Call / Text / Navigate stay in reach */}
      <header className="sticky top-12 z-20 border-b bg-background px-4 py-3 md:static md:px-6 md:py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{name}</h1>
            <p className="truncate text-muted-foreground">{fullAddress ?? "No address yet"}</p>
          </div>
          <div className="hidden gap-2 md:flex">
            {primaryDeal ? <LogContactDialog opportunityId={primaryDeal.id} customerId={customer.id} customerName={name} /> : null}
            {customer.email ? (
              <Button asChild variant="outline" className="h-9">
                <a href={`mailto:${customer.email}`}>
                  <Mail className="size-4" aria-hidden />
                  Email
                </a>
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 md:mt-2 md:flex">
          <ContactButton href={tel} icon={<Phone className="size-4" aria-hidden />} label="Call" detail={formatPhone(customer.phone)} primary />
          <ContactButton href={sms ?? null} icon={<MessageSquare className="size-4" aria-hidden />} label="Text" />
          <ContactButton href={maps} icon={<MapPin className="size-4" aria-hidden />} label="Navigate" external />
        </div>
      </header>

      {/* Deals */}
      <section aria-label="Deals" className="space-y-3 px-4 pt-4 md:px-6">
        {deals.length === 0 ? (
          <EmptyState title="No deals yet" description="Create a lead for this customer to start a deal." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {deals.map((deal) => (
              <DealSummaryCard
                key={deal.id}
                deal={summarizeDeal(deal, addressOf(deal.property_id), timeZone)}
                href={`/opportunities/${deal.id}`}
                actions={
                  bucket(deal) === "open" ? (
                    <>
                      <LogContactDialog
                        opportunityId={deal.id}
                        customerId={customer.id}
                        customerName={name}
                        trigger={
                          <Button variant="outline" className="h-11 md:h-8">
                            Log contact
                          </Button>
                        }
                      />
                      <ScheduleAppointmentDialog
                        defaults={{
                          opportunityId: deal.id,
                          dealLabel: `${name} — ${deal.title}`,
                          date: today,
                          assigneeId: deal.owner_id,
                          type: deal.appointments.some((a) => a.type === "inspection" && (a.status === "scheduled" || a.status === "completed")) ? "other" : "inspection",
                        }}
                        users={users}
                        trigger={
                          <Button variant="outline" className="h-11 md:h-8">
                            Schedule
                          </Button>
                        }
                      />
                    </>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </section>

      <CustomerPanels
        timeline={
          <div className="space-y-4">
            <div className="hidden md:block">
              <NoteComposer parent={noteParent} revalidate={path} showShare />
            </div>
            {primaryDeal ? (
              <MilestoneStrip
                milestones={[
                  { label: "Lead received", done: milestoneTypes.has("lead_received") },
                  { label: "Called", done: ["call", "email", "sms"].some((t) => milestoneTypes.has(t)) },
                  { label: "Inspection", done: hasCompletedInspection || milestoneTypes.has("appointment_completed") },
                  { label: "Photos uploaded", done: milestoneTypes.has("files_uploaded") },
                  { label: "Estimate sent", done: milestoneTypes.has("estimate_sent") },
                ]}
              />
            ) : null}
            <Timeline items={timelineItems} />
          </div>
        }
        tasks={
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Next steps</h2>
              <AddTaskDialog parent={noteParent} users={users} defaultAssignee={me.id} defaultDue={defaultDue} revalidate={path} />
            </div>
            <TaskList tasks={taskItems} revalidate={path} emptyText="No open tasks for this customer." />
          </div>
        }
        files={
          <div className="space-y-3">
            <h2 className="font-semibold">Files</h2>
            <p className="text-muted-foreground">Photos and documents arrive in a later phase.</p>
          </div>
        }
        details={
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Contact details</h2>
                <EditCustomerDialog
                  customer={customer}
                  trigger={
                    <Button variant="ghost" className="h-11 md:h-8">
                      <Pencil className="size-4" aria-hidden />
                      Edit
                    </Button>
                  }
                />
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <Detail label="Phone" value={formatPhone(customer.phone)} href={tel} />
                <Detail label="Other phone" value={formatPhone(customer.secondary_phone)} href={telHref(customer.secondary_phone)} />
                <Detail label="Email" value={customer.email} href={customer.email ? `mailto:${customer.email}` : null} />
                <Detail label="Company" value={customer.company_name} />
                <Detail label="Prefers" value={customer.preferred_contact} />
              </dl>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Properties</h2>
                <PropertyDialog
                  customerId={customer.id}
                  trigger={
                    <Button variant="ghost" className="h-11 md:h-8">
                      <Plus className="size-4" aria-hidden />
                      Add
                    </Button>
                  }
                />
              </div>
              {customer.properties.length === 0 ? (
                <p className="text-muted-foreground">No properties yet.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {customer.properties.map((property) => (
                    <li key={property.id} className="flex items-start justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {property.address_line1}
                          {property.label ? <span className="font-normal text-muted-foreground"> · {property.label}</span> : null}
                        </p>
                        <p className="text-muted-foreground">{[property.city, property.state, property.postal_code].filter(Boolean).join(", ")}</p>
                        {property.access_notes ? <p className="mt-1">{property.access_notes}</p> : null}
                      </div>
                      <PropertyDialog
                        customerId={customer.id}
                        property={property}
                        trigger={
                          <Button variant="ghost" size="icon" aria-label={`Edit ${property.address_line1}`} className="size-11 md:size-8">
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        }
      />

      <CustomerFab
        customerId={customer.id}
        customerName={name}
        primaryDealId={primaryDeal?.id ?? null}
        users={users}
        currentUserId={me.id}
        defaultDue={defaultDue}
      />
    </>
  );
}

function ContactButton({
  href,
  icon,
  label,
  detail,
  primary,
  external,
}: {
  href: string | null | undefined;
  icon: React.ReactNode;
  label: string;
  detail?: string;
  primary?: boolean;
  external?: boolean;
}) {
  if (!href) {
    return (
      <Button variant="outline" disabled className="h-11 md:h-9">
        {icon}
        {label}
      </Button>
    );
  }
  return (
    <Button asChild variant={primary ? "default" : "outline"} className="h-11 md:h-9">
      <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {icon}
        {label}
        {detail ? <span className="hidden tabular md:inline"> {detail}</span> : null}
      </a>
    </Button>
  );
}

function Detail({ label, value, href }: { label: string; value: string | null | undefined; href?: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">
        {href ? (
          <a href={href} className="text-primary hover:underline">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </>
  );
}
