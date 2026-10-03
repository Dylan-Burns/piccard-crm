import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Tasks" };

export default async function Page() {
  await requireRole();
  return <PlaceholderPage title="Tasks" phase={3} />;
}
