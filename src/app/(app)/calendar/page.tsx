import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Calendar" };

export default async function Page() {
  await requireRole();
  return <PlaceholderPage title="Calendar" phase={6} />;
}
