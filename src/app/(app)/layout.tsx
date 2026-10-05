import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await requireRole();
  const supabase = await createClient();
  const { data: settings } = await supabase.from("company_settings").select("company_name").maybeSingle();
  // Admins are told when an integration needs attention. Connection status is service-role data
  // shown only to admins (CLAUDE.md rule 4).
  const broken =
    profile.role === "admin" ? ((await createAdminClient().from("integration_connections").select("provider").eq("status", "error")).data ?? []).map((row) => row.provider) : [];
  const googleBroken = broken.includes("google_calendar");
  const quickbooksBroken = broken.includes("quickbooks");

  return (
    <AppShell
      user={{ fullName: profile.full_name, email: profile.email, role: profile.role }}
      companyName={settings?.company_name ?? "CRM"}
    >
      {googleBroken ? (
        <p role="alert" className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-destructive md:px-6">
          Google Calendar is disconnected, so appointments are not reaching the calendar. They are still saved here.{" "}
          <Link href="/settings/integrations" className="font-medium underline">
            Reconnect
          </Link>
        </p>
      ) : null}
      {quickbooksBroken ? (
        <p role="alert" className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-destructive md:px-6">
          QuickBooks is disconnected, so invoices are not being sent and payments are not being checked. Invoices are still saved here.{" "}
          <Link href="/settings/integrations" className="font-medium underline">
            Reconnect
          </Link>
        </p>
      ) : null}
      {children}
    </AppShell>
  );
}
