"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/shared/use-action-toast";
import { keepBothDeals } from "@/features/opportunities/actions";
import { markLost } from "@/features/pipeline/actions";

/** Shown when create_lead flagged this deal as a possible duplicate (spec §6.5). */
export function DuplicateBanner({ opportunityId, customerId, other }: { opportunityId: string; customerId: string; other: { id: string; title: string } }) {
  const [state, action, pending] = useActionState(keepBothDeals, null);
  useActionToast(state, "Kept both deals");
  const [marking, startMark] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/50 bg-warning/5 p-3">
      <p className="min-w-0">
        This may duplicate another open deal for the same customer:{" "}
        <Link href={`/opportunities/${other.id}`} className="font-medium underline">
          {other.title}
        </Link>
      </p>
      <div className="flex gap-2">
        <form action={action}>
          <input type="hidden" name="opportunity_id" value={opportunityId} />
          <Button type="submit" variant="outline" className="h-11 md:h-9" disabled={pending || marking}>
            Keep both
          </Button>
        </form>
        <Button
          variant="outline"
          className="h-11 text-destructive md:h-9"
          disabled={pending || marking}
          onClick={() =>
            startMark(async () => {
              const result = await markLost({ opportunityId, customerId, reason: "duplicate" });
              if (result.ok) toast.success("Marked as a duplicate");
              else toast.error(result.error.message);
            })
          }
        >
          Mark as duplicate
        </Button>
      </div>
    </div>
  );
}
