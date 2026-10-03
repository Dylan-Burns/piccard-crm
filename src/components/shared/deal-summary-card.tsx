import Link from "next/link";
import { StageBadge } from "@/components/shared/stage-badge";
import type { Database } from "@/types/database";

type Stage = Database["public"]["Enums"]["opportunity_stage"];

export type DealSummary = {
  id: string;
  /** "Roof Replacement" */
  workLabel: string;
  /** "$24,800" or null when no value is known yet */
  value: string | null;
  address: string | null;
  stage: Stage;
  /** "Oct 7, 10:00 AM" plus whether it already happened */
  inspection: { label: string; done: boolean } | null;
  /** "Sent (E-1001)" */
  estimate: string | null;
  status: string;
  owner: string | null;
  jobLabel?: string | null;
};

/**
 * The benchmark block (spec §5.4):
 *   Roof Replacement · $24,800        [stage]
 *   123 Main Street
 *   Inspection: Oct 7, 10:00 AM
 *   Estimate: Sent (E-1001)
 *   Status: Awaiting Signature
 */
export function DealSummaryCard({ deal, actions, href }: { deal: DealSummary; actions?: React.ReactNode; href?: string }) {
  const heading = (
    <>
      <span>{deal.workLabel}</span>
      {deal.value ? <span className="tabular"> · {deal.value}</span> : null}
    </>
  );
  return (
    <article className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-base font-semibold">
          {href ? (
            <Link href={href} className="hover:underline">
              {heading}
            </Link>
          ) : (
            heading
          )}
        </h3>
        <StageBadge stage={deal.stage} />
      </div>
      {deal.address ? <p className="text-muted-foreground">{deal.address}</p> : null}
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        <Row label="Inspection" value={deal.inspection ? `${deal.inspection.label}${deal.inspection.done ? " (done)" : ""}` : "Not scheduled"} muted={!deal.inspection} />
        <Row label="Estimate" value={deal.estimate ?? "None yet"} muted={!deal.estimate} />
        <Row label="Status" value={deal.status} strong />
        {deal.jobLabel ? <Row label="Job" value={deal.jobLabel} /> : null}
        <Row label="Owner" value={deal.owner ?? "Unassigned"} muted={!deal.owner} />
      </dl>
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}

function Row({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className={strong ? "font-medium" : muted ? "text-muted-foreground" : undefined}>{value}</dd>
    </>
  );
}
