import type { Metadata } from "next";
import { PriceBookManager } from "@/features/estimates/components/price-book-manager";
import { listPriceBook } from "@/features/estimates/queries";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Price book" };

export default async function PriceBookPage() {
  await requireRole("admin");
  const items = await listPriceBook();
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-base font-semibold">Price book</h2>
        <p className="text-muted-foreground">Items to add to estimates. Changing a price here does not change estimates already written.</p>
      </div>
      <PriceBookManager items={items} />
    </div>
  );
}
