import type { DealSummary } from "@/components/shared/deal-summary-card";
import { formatDateTime } from "@/lib/dates";
import { dealStatus, ESTIMATE_STATUS_LABELS, JOB_STATUS_LABELS, WORK_TYPE_LABELS } from "@/lib/deal-status";
import { formatCents } from "@/lib/money";
import type { Database } from "@/types/database";

type Enums = Database["public"]["Enums"];

/** The fields needed to build a deal summary card, as selected by the customer and deal queries. */
export type SummarizableDeal = {
  id: string;
  stage: Enums["opportunity_stage"];
  work_type: Enums["work_type"] | null;
  estimated_value_cents: number | null;
  amount_cents: number | null;
  lost_reason: Enums["lost_reason"] | null;
  owner: { full_name: string } | null;
  estimates: { estimate_number: number; version: number; status: Enums["estimate_status"]; total_cents: number; created_at: string }[];
  appointments: { type: Enums["appointment_type"]; status: Enums["appointment_status"]; starts_at: string }[];
  jobs: { id: string; job_number: number; status: Enums["job_status"] } | null;
};

export function estimateLabel(e: { estimate_number: number; version: number }) {
  return `E-${e.estimate_number}${e.version > 1 ? `-v${e.version}` : ""}`;
}

export function summarizeDeal(deal: SummarizableDeal, address: string | null, timeZone: string): DealSummary {
  const inspections = deal.appointments.filter((a) => a.type === "inspection");
  const scheduled = inspections.filter((a) => a.status === "scheduled").sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const completed = inspections.filter((a) => a.status === "completed").sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];
  const estimate = deal.estimates.filter((e) => e.status !== "void").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const value = deal.amount_cents ?? deal.estimated_value_cents;
  const shown = scheduled ?? completed;

  return {
    id: deal.id,
    workLabel: deal.work_type ? WORK_TYPE_LABELS[deal.work_type] : "New inquiry",
    value: value ? formatCents(value) : null,
    address,
    stage: deal.stage,
    inspection: shown ? { label: formatDateTime(shown.starts_at, timeZone), done: !scheduled } : null,
    estimate: estimate ? `${ESTIMATE_STATUS_LABELS[estimate.status]} (${estimateLabel(estimate)})` : null,
    status: dealStatus({
      stage: deal.stage,
      lostReason: deal.lost_reason,
      estimateStatus: estimate?.status ?? null,
      hasScheduledInspection: Boolean(scheduled),
      hasCompletedInspection: Boolean(completed),
      jobStatus: deal.jobs?.status ?? null,
    }),
    owner: deal.owner?.full_name ?? null,
    jobLabel: deal.jobs ? `J-${deal.jobs.job_number} · ${JOB_STATUS_LABELS[deal.jobs.status]}` : null,
  };
}
