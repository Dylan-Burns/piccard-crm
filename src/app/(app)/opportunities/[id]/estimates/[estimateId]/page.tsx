import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EstimateBuilder } from "@/features/estimates/components/estimate-builder";
import { EstimateStatusBadge } from "@/features/estimates/components/estimate-status-badge";
import { estimateLabel, getEstimate, listPriceBook } from "@/features/estimates/queries";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Estimate" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function EstimatePage({ params }: PageProps<"/opportunities/[id]/estimates/[estimateId]">) {
  await requireRole("admin", "sales");
  const { id, estimateId } = await params;
  if (!UUID.test(id) || !UUID.test(estimateId)) notFound();
  const estimate = await getEstimate(estimateId);
  if (!estimate || estimate.opportunity_id !== id) notFound();
  const editable = estimate.status === "draft";
  const priceBook = editable ? await listPriceBook({ activeOnly: true }) : [];
  const label = estimateLabel(estimate);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 md:px-6">
        <div className="min-w-0">
          <Link href={`/opportunities/${id}`} className="inline-flex min-h-11 items-center gap-1 text-muted-foreground hover:text-foreground md:min-h-0">
            <ChevronLeft className="size-4" aria-hidden />
            Deal
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">
              Estimate <span className="tabular">{label}</span>
            </h1>
            <EstimateStatusBadge status={estimate.status} />
          </div>
          {editable ? null : <p className="text-muted-foreground">This estimate is no longer a draft, so it cannot be edited.</p>}
        </div>
        <Button asChild variant="outline" className="h-11 md:h-9">
          <a href={`/api/estimates/${estimate.id}/pdf`} target="_blank" rel="noreferrer">
            <FileText className="size-4" aria-hidden />
            Preview PDF
          </a>
        </Button>
      </header>
      <EstimateBuilder
        // Reset only when the status changes (for example after a void). Remounting after every save
        // would discard anything typed while the save was finishing.
        key={estimate.status}
        estimate={{
          id: estimate.id,
          opportunityId: id,
          editable,
          voidable: ["draft", "sent", "viewed", "expired"].includes(estimate.status),
          title: estimate.title,
          scopeNotes: estimate.scope_notes ?? "",
          terms: estimate.terms,
          discountCents: estimate.discount_cents,
          taxRate: Number(estimate.tax_rate),
          depositPercent: estimate.deposit_percent,
          validUntil: estimate.valid_until ?? "",
          stored: {
            subtotalCents: estimate.subtotal_cents,
            discountCents: Math.min(estimate.discount_cents, estimate.subtotal_cents),
            taxCents: estimate.tax_cents,
            totalCents: estimate.total_cents,
            depositCents: estimate.deposit_cents,
          },
          lines: estimate.estimate_line_items.map((l) => ({ id: l.id, name: l.name, description: l.description, quantity: Number(l.quantity), unit: l.unit, unitPriceCents: l.unit_price_cents, isTaxable: l.is_taxable })),
        }}
        priceBook={priceBook}
      />
    </>
  );
}
