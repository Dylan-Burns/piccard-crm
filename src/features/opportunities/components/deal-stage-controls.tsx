"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/shared/native-select";
import { reopenDeal } from "@/features/pipeline/actions";
import { useDealMoves, type MovableDeal, type OpenStage } from "@/features/pipeline/components/deal-dialogs";
import { OPEN_STAGES, STAGE_LABELS } from "@/lib/deal-status";
import type { StaffOption } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type Stage = Database["public"]["Enums"]["opportunity_stage"];

/** Stage stepper with move, Won, Lost, and Reopen (spec §5.4). */
export function DealStageControls({ deal, stage, inStage, staff, users, today }: { deal: MovableDeal; stage: Stage; /** How long the deal has been in its stage, e.g. "4 days". */ inStage: string; staff: StaffOption[]; users: StaffOption[]; today: string }) {
  const { move, dialogs, pending } = useDealMoves({ staff, users, today });
  const [reopening, startReopen] = useTransition();
  const currentIndex = OPEN_STAGES.indexOf(stage as OpenStage);
  const closed = stage === "won" || stage === "lost";

  return (
    <div className="space-y-3">
      {/* Stepper: arrows on desktop, showing the time in the current stage; phones use the select below. */}
      <ol className="hidden md:flex" aria-label="Stages">
        {OPEN_STAGES.map((s, index) => {
          const done = !closed && index < currentIndex;
          const current = s === stage;
          return (
            <li key={s} className={cn("min-w-0", current ? "flex-[1.5]" : "flex-1", index > 0 && "-ml-1.5")}>
              <button
                type="button"
                disabled={closed || current || pending}
                onClick={() => move(deal, s)}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex h-9 w-full items-center justify-center gap-1 px-4 text-xs",
                  // Arrow shape: a point on the right, a matching notch on the left (none on the first).
                  index === 0
                    ? "rounded-l-md [clip-path:polygon(0_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,0_100%)]"
                    : "[clip-path:polygon(0_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,0_100%,10px_50%)]",
                  current && "bg-primary font-medium text-primary-foreground",
                  done && "bg-primary/20 text-primary",
                  !current && !done && "bg-border/70 text-muted-foreground",
                  !closed && !current && "hover:bg-primary/30 hover:text-primary",
                )}
              >
                {done ? <Check className="size-3 shrink-0" aria-hidden /> : null}
                <span className="truncate">
                  {current ? `${inStage} · ` : ""}
                  {STAGE_LABELS[s]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        {closed ? null : (
          <NativeSelect
            aria-label="Move to stage"
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && move(deal, e.target.value as OpenStage)}
            className="w-auto flex-1 md:hidden"
          >
            <option value="">Stage: {STAGE_LABELS[stage]} · Move to…</option>
            {OPEN_STAGES.filter((s) => s !== stage).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        )}
        {stage === "lost" ? (
          <NativeSelect
            aria-label="Reopen to stage"
            value=""
            disabled={reopening}
            className="w-auto"
            onChange={(e) => {
              const toStage = e.target.value as OpenStage;
              if (!toStage) return;
              startReopen(async () => {
                const result = await reopenDeal({ opportunityId: deal.id, customerId: deal.customerId, toStage });
                if (result.ok) toast.success(`Reopened in ${STAGE_LABELS[toStage]}`);
                else toast.error(result.error.message);
              });
            }}
          >
            <option value="">Reopen in…</option>
            {OPEN_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        {closed ? null : (
          <>
            <Button className="h-11 bg-success text-white hover:bg-success/90 md:h-9" onClick={() => move(deal, "won")}>
              Won
            </Button>
            <Button variant="outline" className="h-11 text-destructive md:h-9" onClick={() => move(deal, "lost")}>
              Lost
            </Button>
          </>
        )}
      </div>
      {dialogs}
    </div>
  );
}
