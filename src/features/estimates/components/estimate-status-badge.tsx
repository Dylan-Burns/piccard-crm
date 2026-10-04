import { ESTIMATE_STATUS_LABELS } from "@/lib/deal-status";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type Status = Database["public"]["Enums"]["estimate_status"];

const TONE: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary/10 text-primary",
  viewed: "bg-primary/10 text-primary",
  accepted: "bg-success/10 text-success",
  declined: "bg-destructive/10 text-destructive",
  expired: "bg-amber-500/10 text-amber-700",
  void: "bg-muted text-muted-foreground line-through",
};

export function EstimateStatusBadge({ status }: { status: Status }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded px-1.5 text-xs font-medium", TONE[status])}>{ESTIMATE_STATUS_LABELS[status]}</span>;
}
