import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateLabel, loadEstimate } from "@/features/estimates/queries";
import type { Database } from "@/types/database";

/** Everything the PDF shows, as plain values (spec §7.3). Money stays in cents; the document formats it. */
export type EstimateDocumentData = {
  company: { name: string; licenseNumber: string | null; addressLines: string[]; phone: string | null; email: string | null; logo: { data: Buffer; format: "png" | "jpg" } | null };
  customer: { name: string; email: string | null; phone: string | null };
  propertyLines: string[];
  estimate: {
    label: string;
    title: string;
    status: Database["public"]["Enums"]["estimate_status"];
    date: string;
    validUntil: string | null;
    scopeNotes: string | null;
    terms: string;
    taxRate: number;
    depositPercent: number;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    depositCents: number;
  };
  lines: { name: string; description: string | null; quantity: number; unit: string; unitPriceCents: number; totalCents: number }[];
};

const cityLine = (p: { city: string | null; state: string | null; postal_code: string | null }) => [[p.city, p.state].filter(Boolean).join(", "), p.postal_code].filter(Boolean).join(" ");

/**
 * Loads an estimate for rendering through the caller's client, so RLS decides who may see it.
 * `logo` is supplied by the caller (it needs a signed storage URL) and may be null.
 */
export async function loadEstimateDocumentData(
  supabase: SupabaseClient<Database>,
  estimateId: string,
  logo: EstimateDocumentData["company"]["logo"] = null,
): Promise<EstimateDocumentData | null> {
  const estimate = await loadEstimate(supabase, estimateId);
  if (!estimate) return null;
  const [{ data: deal }, { data: settings }] = await Promise.all([
    supabase
      .from("opportunities")
      .select("customer:customers!inner(first_name, last_name, email, phone), property:properties(address_line1, address_line2, city, state, postal_code)")
      .eq("id", estimate.opportunity_id)
      .maybeSingle(),
    supabase.from("company_settings").select("company_name, license_number, address_line1, city, state, postal_code, phone, email, timezone").maybeSingle(),
  ]);
  if (!deal || !settings) return null;

  const date = new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone, dateStyle: "long" });
  const day = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "long" }).format(new Date(`${value}T00:00:00Z`));

  return {
    company: {
      name: settings.company_name,
      licenseNumber: settings.license_number,
      addressLines: [settings.address_line1, cityLine(settings)].filter((l): l is string => Boolean(l)),
      phone: settings.phone,
      email: settings.email,
      logo,
    },
    customer: { name: `${deal.customer.first_name} ${deal.customer.last_name}`.trim(), email: deal.customer.email, phone: deal.customer.phone },
    propertyLines: deal.property ? [deal.property.address_line1, deal.property.address_line2, cityLine(deal.property)].filter((l): l is string => Boolean(l)) : [],
    estimate: {
      label: estimateLabel(estimate),
      title: estimate.title,
      status: estimate.status,
      date: date.format(new Date(estimate.sent_at ?? estimate.created_at)),
      validUntil: estimate.valid_until ? day(estimate.valid_until) : null,
      scopeNotes: estimate.scope_notes,
      terms: estimate.terms,
      taxRate: Number(estimate.tax_rate),
      depositPercent: estimate.deposit_percent,
      subtotalCents: estimate.subtotal_cents,
      discountCents: Math.min(estimate.discount_cents, estimate.subtotal_cents),
      taxCents: estimate.tax_cents,
      totalCents: estimate.total_cents,
      depositCents: estimate.deposit_cents,
    },
    lines: estimate.estimate_line_items.map((l) => ({ name: l.name, description: l.description, quantity: Number(l.quantity), unit: l.unit, unitPriceCents: l.unit_price_cents, totalCents: l.total_cents ?? 0 })),
  };
}
