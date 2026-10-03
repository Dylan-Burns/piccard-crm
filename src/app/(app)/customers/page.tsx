import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Customers" };

export default async function Page() {
  await requireRole("admin", "sales");
  return <PlaceholderPage title="Customers" phase={3} />;
}
