import type { Metadata } from "next";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { CUSTOMERS_PAGE_SIZE, listCustomers, type CustomerListRow } from "@/features/customers/queries";
import { requireRole } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Customers" };

function primaryAddress(customer: CustomerListRow) {
  const property = customer.properties.find((p) => p.is_primary) ?? customer.properties[0];
  return property ? [property.address_line1, property.city].filter(Boolean).join(", ") : null;
}

function openDeals(customer: CustomerListRow) {
  return customer.opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost").length;
}

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  await requireRole("admin", "sales");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const { customers, total } = await listCustomers(q, page);
  const pages = Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE));
  const pageHref = (n: number) => `/customers?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

  return (
    <>
      <PageHeader title="Customers" description={`${total} ${total === 1 ? "customer" : "customers"}${q ? ` matching “${q}”` : ""}`} />
      <div className="space-y-4 p-4 md:p-6">
        <form action="/customers" role="search" className="flex max-w-xl gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              name="q"
              type="search"
              defaultValue={q}
              aria-label="Search customers"
              placeholder="Name, phone, email, or address"
              className="h-11 pl-9 md:h-9"
            />
          </div>
          <Button type="submit" variant="outline" className="h-11 md:h-9">
            Search
          </Button>
        </form>

        {customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? "No customers match that search" : "No customers yet"}
            description={q ? "Try a name, phone number, email, or street address." : "Customers are created when a lead comes in."}
          />
        ) : (
          <ul className="divide-y rounded-md border">
            {customers.map((customer) => {
              const address = primaryAddress(customer);
              const open = openDeals(customer);
              return (
                <li key={customer.id}>
                  <Link href={`/customers/${customer.id}`} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2 hover:bg-muted/50">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {customer.first_name} {customer.last_name}
                        {customer.company_name ? <span className="font-normal text-muted-foreground"> · {customer.company_name}</span> : null}
                      </p>
                      <p className="truncate text-muted-foreground">
                        {[address, formatPhone(customer.phone), customer.email].filter(Boolean).join(" · ") || "No contact details"}
                      </p>
                    </div>
                    {open > 0 ? (
                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        {open} open {open === 1 ? "deal" : "deals"}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between">
            <Button asChild={page > 1} variant="outline" disabled={page <= 1} className="h-11 md:h-9">
              {page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span>Previous</span>}
            </Button>
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <Button asChild={page < pages} variant="outline" disabled={page >= pages} className="h-11 md:h-9">
              {page < pages ? <Link href={pageHref(page + 1)}>Next</Link> : <span>Next</span>}
            </Button>
          </nav>
        ) : null}
      </div>
    </>
  );
}
