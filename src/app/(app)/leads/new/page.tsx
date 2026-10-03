import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { NewLeadForm } from "@/features/leads/components/new-lead-form";
import { listLeadSources } from "@/features/leads/queries";
import { requireRole } from "@/lib/auth";
import { listStaffOptions } from "@/lib/settings";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const me = await requireRole("admin", "sales");
  const [sources, staff] = await Promise.all([listLeadSources(), listStaffOptions()]);

  return (
    <>
      <PageHeader title="New lead" />
      <div className="p-4 md:p-6">
        <NewLeadForm sources={sources.filter((s) => s.is_active)} staff={staff} defaultOwnerId={me.role === "sales" ? me.id : ""} />
      </div>
    </>
  );
}
