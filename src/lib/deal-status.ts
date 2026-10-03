import type { Database } from "@/types/database";

type Enums = Database["public"]["Enums"];

export const STAGE_LABELS: Record<Enums["opportunity_stage"], string> = {
  new: "New Lead",
  contacted: "Contacted",
  qualified: "Qualified",
  inspection_scheduled: "Inspection Scheduled",
  estimate_sent: "Estimate Sent",
  negotiation: "Follow-Up / Negotiation",
  won: "Won",
  lost: "Lost",
};

export const OPEN_STAGES = ["new", "contacted", "qualified", "inspection_scheduled", "estimate_sent", "negotiation"] as const;

export const WORK_TYPE_LABELS: Record<Enums["work_type"], string> = {
  roof_replacement: "Roof Replacement",
  roof_repair: "Roof Repair",
  renovation: "Renovation",
  gutters: "Gutters",
  siding: "Siding",
  other: "Other",
};

export const LOST_REASON_LABELS: Record<Enums["lost_reason"], string> = {
  price: "Price",
  competitor: "Went with a competitor",
  no_response: "No response",
  not_qualified: "Not qualified",
  insurance_denied: "Insurance denied",
  timing: "Timing",
  duplicate: "Duplicate",
  other: "Other",
};

export const JOB_STATUS_LABELS: Record<Enums["job_status"], string> = {
  pending_schedule: "Pending Schedule",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ESTIMATE_STATUS_LABELS: Record<Enums["estimate_status"], string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  void: "Void",
};

export type DealStatusInput = {
  stage: Enums["opportunity_stage"];
  lostReason?: Enums["lost_reason"] | null;
  /** Latest non-void estimate, if any. */
  estimateStatus?: Enums["estimate_status"] | null;
  /** Whether a scheduled inspection exists, and whether one has been completed. */
  hasScheduledInspection?: boolean;
  hasCompletedInspection?: boolean;
  jobStatus?: Enums["job_status"] | null;
};

/** The one-line "Status:" shown on a deal card (spec §5.4). First match wins. */
export function dealStatus(input: DealStatusInput): string {
  if (input.stage === "lost") return `Lost — ${input.lostReason ? LOST_REASON_LABELS[input.lostReason] : "No reason given"}`;
  if (input.jobStatus) return `Job ${JOB_STATUS_LABELS[input.jobStatus]}`;
  switch (input.estimateStatus) {
    case "accepted": return "Accepted";
    case "sent":
    case "viewed": return "Awaiting Signature";
    case "declined": return "Estimate Declined";
    case "expired": return "Estimate Expired";
    case "draft": return "Estimate In Progress";
  }
  if (input.hasCompletedInspection) return "Estimate Needed";
  if (input.hasScheduledInspection) return "Inspection Scheduled";
  if (input.stage === "qualified") return "Needs Inspection";
  if (input.stage === "contacted") return "Qualifying";
  return "Needs First Contact";
}
