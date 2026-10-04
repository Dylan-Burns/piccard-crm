"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createEstimate } from "@/features/estimates/actions";
import { EstimateStatusBadge } from "@/features/estimates/components/estimate-status-badge";
import type { Database } from "@/types/database";

export type EstimateRow = { id: string; label: string; title: string; status: Database["public"]["Enums"]["estimate_status"]; total: string };

/** Versions of the deal's estimates with status, a PDF preview link, and "New estimate". */
export function EstimatesPanel({ opportunityId, estimates, canCreate }: { opportunityId: string; estimates: EstimateRow[]; canCreate: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      const result = await createEstimate({ opportunityId });
      if (result.ok) router.push(`/opportunities/${opportunityId}/estimates/${result.data.estimateId}`);
      else toast.error(result.error.message);
    });

  return (
    <section aria-label="Estimates" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Estimates</h2>
        {canCreate ? (
          <Button variant="outline" className="h-11 md:h-9" disabled={pending} onClick={create}>
            <Plus className="size-4" aria-hidden />
            New estimate
          </Button>
        ) : null}
      </div>
      {estimates.length === 0 ? (
        <p className="text-muted-foreground">No estimates yet.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {estimates.map((estimate) => (
            <li key={estimate.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <Link href={`/opportunities/${opportunityId}/estimates/${estimate.id}`} className="min-w-0 flex-1 py-1 hover:underline">
                <span className="font-medium tabular">{estimate.label}</span> <span className="text-muted-foreground">{estimate.title}</span>
              </Link>
              <span className="tabular">{estimate.total}</span>
              <EstimateStatusBadge status={estimate.status} />
              <Button asChild variant="ghost" className="h-11 md:h-8">
                <a href={`/api/estimates/${estimate.id}/pdf`} target="_blank" rel="noreferrer" aria-label={`Preview PDF of ${estimate.label}`}>
                  <FileText className="size-4" aria-hidden />
                  PDF
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
