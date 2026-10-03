import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StageBadge } from "@/components/shared/stage-badge";
import { PageHeader } from "@/components/shell/page-header";
import { LogContactDialog } from "@/features/leads/components/log-contact-dialog";
import { OwnerSelect } from "@/features/leads/components/owner-select";
import { listLeads, type LeadRow } from "@/features/leads/queries";
import { requireRole } from "@/lib/auth";
import { age, dueState, relativeTime } from "@/lib/dates";
import { WORK_TYPE_LABELS } from "@/lib/deal-status";
import { formatPhone, telHref } from "@/lib/phone";
import { getTimeZone, listStaffOptions, type StaffOption } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage() {
  await requireRole("admin", "sales");
  const [leads, staff, timeZone] = await Promise.all([listLeads(), listStaffOptions(), getTimeZone()]);

  return (
    <>
      <PageHeader
        title="Leads"
        description="New and contacted leads, newest first."
        actions={
          <Button asChild className="h-11 md:h-9">
            <Link href="/leads/new">
              <Plus className="size-4" aria-hidden />
              New lead
            </Link>
          </Button>
        }
      />
      <div className="p-4 md:p-6">
        {leads.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No open leads"
            description="New website and Google Ads leads will appear here. You can also add one by hand."
          />
        ) : (
          <>
            {/* Phone: cards */}
            <ul className="space-y-3 md:hidden">
              {leads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} staff={staff} timeZone={timeZone} />
              ))}
            </ul>
            {/* Desktop: table */}
            <div className="hidden overflow-x-auto rounded-md border md:block">
              <table className="w-full text-left">
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="h-9 px-3 font-medium">Lead</th>
                    <th className="px-3 font-medium">Phone</th>
                    <th className="px-3 font-medium">Source</th>
                    <th className="px-3 font-medium">Age</th>
                    <th className="px-3 font-medium">Owner</th>
                    <th className="px-3 font-medium">Next step</th>
                    <th className="px-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leads.map((lead) => (
                    <LeadTableRow key={lead.id} lead={lead} staff={staff} timeZone={timeZone} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function name(lead: LeadRow) {
  return `${lead.customer.first_name} ${lead.customer.last_name}`.trim();
}

function NextStep({ lead, timeZone }: { lead: LeadRow; timeZone: string }) {
  const task = lead.tasks[0];
  if (!task) return <span className="text-warning">No next step</span>;
  const state = dueState(task.due_at, timeZone);
  return (
    <span className={cn(state === "overdue" && "font-medium text-destructive", state === "today" && "text-warning")}>
      {task.title}
      <span className="text-muted-foreground"> · {state === "overdue" ? "overdue" : relativeTime(task.due_at)}</span>
    </span>
  );
}

function LeadTableRow({ lead, staff, timeZone }: { lead: LeadRow; staff: StaffOption[]; timeZone: string }) {
  const tel = telHref(lead.customer.phone, lead.customer.phone_e164);
  return (
    <tr className={cn("h-12", !lead.owner_id && "bg-warning/5")}>
      <td className="px-3">
        <Link href={`/customers/${lead.customer_id}`} className="font-medium hover:underline">
          {name(lead)}
        </Link>
        <div className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
          <StageBadge stage={lead.stage} />
          {lead.work_type ? WORK_TYPE_LABELS[lead.work_type] : "Type not set"}
        </div>
      </td>
      <td className="px-3 whitespace-nowrap tabular">
        {tel ? (
          <a href={tel} className="text-primary hover:underline">
            {formatPhone(lead.customer.phone)}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 whitespace-nowrap">{lead.source?.name ?? "—"}</td>
      <td className="px-3 tabular whitespace-nowrap">{age(lead.created_at)}</td>
      <td className="px-3">
        <OwnerSelect opportunityId={lead.id} customerId={lead.customer_id} ownerId={lead.owner_id} staff={staff} className="w-40" />
      </td>
      <td className="max-w-64 truncate px-3">
        <NextStep lead={lead} timeZone={timeZone} />
      </td>
      <td className="px-3 text-right whitespace-nowrap">
        <LogContactDialog opportunityId={lead.id} customerId={lead.customer_id} customerName={name(lead)} />
      </td>
    </tr>
  );
}

function LeadCard({ lead, staff, timeZone }: { lead: LeadRow; staff: StaffOption[]; timeZone: string }) {
  const tel = telHref(lead.customer.phone, lead.customer.phone_e164);
  return (
    <li className={cn("space-y-3 rounded-md border p-3", !lead.owner_id && "border-warning/50 bg-warning/5")}>
      <div className="flex items-start justify-between gap-3">
        <Link href={`/customers/${lead.customer_id}`} className="min-w-0">
          <p className="truncate font-medium">{name(lead)}</p>
          <p className="truncate text-muted-foreground">
            {lead.work_type ? WORK_TYPE_LABELS[lead.work_type] : "Type not set"} · {lead.source?.name ?? "Unknown source"}
          </p>
        </Link>
        <div className="shrink-0 text-right">
          <StageBadge stage={lead.stage} />
          <p className="mt-1 text-xs text-muted-foreground tabular">{age(lead.created_at)}</p>
        </div>
      </div>
      <p className="truncate">
        <NextStep lead={lead} timeZone={timeZone} />
      </p>
      <OwnerSelect opportunityId={lead.id} customerId={lead.customer_id} ownerId={lead.owner_id} staff={staff} />
      <div className="grid grid-cols-2 gap-2">
        {tel ? (
          <Button asChild className="h-11">
            <a href={tel}>
              <Phone className="size-4" aria-hidden />
              Call
            </a>
          </Button>
        ) : (
          <Button disabled className="h-11">
            No phone
          </Button>
        )}
        <LogContactDialog
          opportunityId={lead.id}
          customerId={lead.customer_id}
          customerName={name(lead)}
          trigger={
            <Button variant="outline" className="h-11">
              Log contact
            </Button>
          }
        />
      </div>
    </li>
  );
}
