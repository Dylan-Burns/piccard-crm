import { PageHeader } from "@/components/shell/page-header";
import { SettingsNav } from "@/features/settings/components/settings-nav";
import { requireRole } from "@/lib/auth";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const profile = await requireRole();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col md:flex-row">
        <SettingsNav isAdmin={profile.role === "admin"} />
        <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
      </div>
    </>
  );
}
