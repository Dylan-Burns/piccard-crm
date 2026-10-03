import { Construction } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shell/page-header";

/** Temporary page body for routes whose feature lands in a later phase (spec §9). */
export function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="p-4 md:p-6">
        <EmptyState icon={Construction} title="Coming soon" description={`This screen is built in phase ${phase}.`} />
      </div>
    </>
  );
}
