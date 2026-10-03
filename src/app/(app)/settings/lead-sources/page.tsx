import type { Metadata } from "next";
import { LeadSourcesManager } from "@/features/settings/components/lead-sources-manager";
import { listLeadSources } from "@/features/leads/queries";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Lead sources" };

export default async function LeadSourcesPage() {
  await requireRole("admin");
  const sources = await listLeadSources();
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="text-base font-semibold">Lead sources</h2>
        <p className="text-muted-foreground">Where leads come from. Used on new leads and in reports.</p>
      </div>
      <LeadSourcesManager sources={sources} />
    </div>
  );
}
