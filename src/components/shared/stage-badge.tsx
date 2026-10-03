import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "@/lib/deal-status";
import type { Database } from "@/types/database";

type Stage = Database["public"]["Enums"]["opportunity_stage"];

const TONE: Record<Stage, string> = {
  new: "bg-primary/10 text-primary",
  contacted: "bg-primary/10 text-primary",
  qualified: "bg-primary/10 text-primary",
  inspection_scheduled: "bg-primary/10 text-primary",
  estimate_sent: "bg-primary/10 text-primary",
  negotiation: "bg-primary/10 text-primary",
  won: "bg-success/10 text-success",
  lost: "bg-destructive/10 text-destructive",
};

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded px-1.5 text-xs font-medium", TONE[stage], className)}>
      {STAGE_LABELS[stage]}
    </span>
  );
}
