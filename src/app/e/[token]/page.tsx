import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicEstimateActions, ViewTracker } from "@/features/estimates/components/public-estimate-actions";
import { loadPublicEstimate } from "@/features/estimates/public";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Estimate", robots: { index: false, follow: false } };
// Always rendered on request with the service client; never cached (next.config.ts adds the headers).
export const dynamic = "force-dynamic";

const money = (cents: number) => formatCents(cents, { alwaysCents: true });
const quantity = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

/**
 * The customer's view of an estimate (spec §7.4). Rendering never changes anything: a link opened
 * by an email scanner must not mark the estimate as viewed. The page script reports a real view.
 */
export default async function PublicEstimatePage({ params }: PageProps<"/e/[token]">) {
  const { token } = await params;
  const estimate = await loadPublicEstimate(token);

  if (!estimate || estimate.state === "unavailable") {
    const { data: company } = await createAdminClient().from("company_settings").select("company_name, phone").maybeSingle();
    return (
      <Shell>
        <div className="rounded-md border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold">This estimate is no longer valid</h1>
          <p className="mt-2 text-muted-foreground">
            Please contact {company?.company_name ?? "us"}
            {company?.phone ? (
              <>
                {" "}
                at{" "}
                <a href={`tel:${company.phone}`} className="text-primary underline">
                  {formatPhone(company.phone)}
                </a>
              </>
            ) : null}{" "}
            for an up-to-date estimate.
          </p>
        </div>
      </Shell>
    );
  }

  const { data, state } = estimate;
  const { company, customer, estimate: e, lines } = data;

  return (
    <Shell>
      {state === "open" ? <ViewTracker token={token} /> : null}
      <header className="rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">{company.name}</p>
            <p className="text-muted-foreground">
              {[company.phone ? formatPhone(company.phone) : null, company.email].filter(Boolean).join(" · ")}
            </p>
            {company.licenseNumber ? <p className="text-muted-foreground">License {company.licenseNumber}</p> : null}
          </div>
          <div className="text-right">
            <h1 className="text-xl font-semibold">
              Estimate <span className="tabular">{e.label}</span>
            </h1>
            <p className="text-muted-foreground">{e.date}</p>
            {e.validUntil ? <p className="text-muted-foreground">Valid until {e.validUntil}</p> : null}
          </div>
        </div>
      </header>

      {state === "accepted" ? (
        <div role="status" className="rounded-md border border-success/40 bg-success/10 p-4">
          <p className="text-base font-semibold text-success">Estimate approved</p>
          <p>
            Thank you{estimate.acceptedName ? `, ${estimate.acceptedName}` : ""}. {company.name} will be in touch to schedule the work. A written contract will follow.
          </p>
        </div>
      ) : null}
      {state === "declined" ? (
        <div role="status" className="rounded-md border bg-card p-4">
          <p className="text-base font-semibold">You declined this estimate</p>
          <p className="text-muted-foreground">Thank you for letting us know. {company.name} may call to see whether a revised estimate would help.</p>
        </div>
      ) : null}

      <section aria-label="Estimate" className="space-y-4 rounded-md border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">Prepared for</p>
            <p className="font-medium">{customer.name}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">Property</p>
            {data.propertyLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-base font-semibold">{e.title}</h2>
          {e.scopeNotes ? <p className="mt-1 whitespace-pre-wrap">{e.scopeNotes}</p> : null}
        </div>

        <ul className="divide-y border-y">
          {lines.map((line, index) => (
            <li key={index} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">{line.name}</p>
                {line.description ? <p className="text-muted-foreground">{line.description}</p> : null}
                <p className="text-muted-foreground tabular">
                  {quantity(line.quantity)} {line.unit} × {money(line.unitPriceCents)}
                </p>
              </div>
              <p className="shrink-0 font-medium tabular">{money(line.totalCents)}</p>
            </li>
          ))}
        </ul>

        <dl aria-label="Totals" className="ml-auto grid max-w-xs grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 tabular">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right">{money(e.subtotalCents)}</dd>
          {e.discountCents > 0 ? (
            <>
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="text-right">−{money(e.discountCents)}</dd>
            </>
          ) : null}
          {e.taxCents > 0 ? (
            <>
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="text-right">{money(e.taxCents)}</dd>
            </>
          ) : null}
          <dt className="text-base font-semibold">Total</dt>
          <dd className="text-right text-base font-semibold">{money(e.totalCents)}</dd>
          {e.depositCents > 0 ? (
            <>
              <dt className="text-muted-foreground">Deposit due on approval ({e.depositPercent}%)</dt>
              <dd className="text-right">{money(e.depositCents)}</dd>
            </>
          ) : null}
        </dl>

        {e.terms ? (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">Terms</p>
            <p className="whitespace-pre-wrap">{e.terms}</p>
          </div>
        ) : null}

        {estimate.hasPdf ? (
          <Button asChild variant="outline" className="h-11">
            <a href={`/api/public/estimates/${token}/pdf`}>
              <FileDown className="size-4" aria-hidden />
              Download PDF
            </a>
          </Button>
        ) : null}
      </section>

      {state === "open" ? <PublicEstimateActions token={token} customerName={customer.name} /> : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-muted px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">{children}</div>
    </main>
  );
}
