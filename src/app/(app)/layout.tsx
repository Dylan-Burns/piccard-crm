import { AppShell } from "@/components/shell/app-shell";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await requireRole();
  const supabase = await createClient();
  const { data: settings } = await supabase.from("company_settings").select("company_name").maybeSingle();

  return (
    <AppShell
      user={{ fullName: profile.full_name, email: profile.email, role: profile.role }}
      companyName={settings?.company_name ?? "CRM"}
    >
      {children}
    </AppShell>
  );
}
