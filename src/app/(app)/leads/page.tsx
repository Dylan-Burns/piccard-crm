import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Leads" };

export default async function Page() {
  await requireRole("admin", "sales");
  return <PlaceholderPage title="Leads" phase={3} />;
}
