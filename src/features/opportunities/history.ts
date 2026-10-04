import type { Database } from "@/types/database";

type ActivityType = Database["public"]["Enums"]["activity_type"];

/** History filter chips on the deal page, in display order. */
export const HISTORY_FILTERS = [
  { key: "all", label: "All" },
  { key: "activities", label: "Activities" },
  { key: "notes", label: "Notes" },
  { key: "emails", label: "Emails" },
  { key: "files", label: "Files" },
  { key: "estimates", label: "Estimates" },
  { key: "invoices", label: "Invoices" },
  { key: "changelog", label: "Changelog" },
] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number]["key"];
export type HistoryKind = Exclude<HistoryFilter, "all">;

const KIND: Record<ActivityType, HistoryKind> = {
  call: "activities",
  sms: "activities",
  appointment_scheduled: "activities",
  appointment_rescheduled: "activities",
  appointment_completed: "activities",
  appointment_cancelled: "activities",
  task_completed: "activities",
  note_added: "notes",
  email: "emails",
  files_uploaded: "files",
  estimate_created: "estimates",
  estimate_sent: "estimates",
  estimate_viewed: "estimates",
  estimate_accepted: "estimates",
  estimate_declined: "estimates",
  estimate_expired: "estimates",
  invoice_created: "invoices",
  invoice_synced: "invoices",
  payment_received: "invoices",
  // Changes to the deal itself
  lead_received: "changelog",
  duplicate_inquiry: "changelog",
  stage_changed: "changelog",
  owner_changed: "changelog",
  deal_won: "changelog",
  deal_lost: "changelog",
  deal_reopened: "changelog",
  job_created: "changelog",
  job_status_changed: "changelog",
  system: "changelog",
};

/** Which history chip a timeline entry belongs under. */
export function historyKind(type: ActivityType): HistoryKind {
  return KIND[type];
}
