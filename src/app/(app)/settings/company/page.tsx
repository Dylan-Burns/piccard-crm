import type { Metadata } from "next";
import { CompanyForm } from "@/features/settings/components/company-form";
import { getCompanySettings, listProfiles } from "@/features/settings/queries";
import { rateToPercent } from "@/features/settings/schemas";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage() {
  await requireRole("admin");
  const [settings, profiles] = await Promise.all([getCompanySettings(), listProfiles()]);
  const owners = profiles
    .filter((p) => p.is_active && p.role !== "field")
    .map((p) => ({ id: p.id, name: p.full_name }));

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-base font-semibold">Company</h2>
        <p className="text-muted-foreground">Used on estimates, emails, and as defaults for new records.</p>
      </div>
      <CompanyForm
        settings={{ ...settings, default_tax_rate_percent: rateToPercent(Number(settings.default_tax_rate)) }}
        owners={owners}
        timeZones={Intl.supportedValuesOf("timeZone").filter((tz) => tz.startsWith("America/") || tz.startsWith("Pacific/"))}
      />
    </div>
  );
}
