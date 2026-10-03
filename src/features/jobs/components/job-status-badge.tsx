import { JOB_STATUS_LABELS } from "@/lib/deal-status";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type Status = Database["public"]["Enums"]["job_status"];

const TONE: Record<Status, string> = {
  pending_schedule: "bg-amber-500/10 text-amber-700",
  scheduled: "bg-primary/10 text-primary",
  in_progress: "bg-primary/10 text-primary",
  on_hold: "bg-amber-500/10 text-amber-700",
  completed: "bg-success/10 text-success",
  cancelled: "bg-destructive/10 text-destructive",
};

export function JobStatusBadge({ status, className }: { status: Status; className?: string }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded px-1.5 text-xs font-medium", TONE[status], className)}>{JOB_STATUS_LABELS[status]}</span>;
}
