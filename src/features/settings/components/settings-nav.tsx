"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Price book and integrations are added in phases 9 and 5/12/13.
const ITEMS = [
  { href: "/settings/profile", label: "Profile", adminOnly: false },
  { href: "/settings/company", label: "Company", adminOnly: true },
  { href: "/settings/users", label: "Users", adminOnly: true },
  { href: "/settings/lead-sources", label: "Lead sources", adminOnly: true },
];

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => isAdmin || !i.adminOnly);

  return (
    <nav
      aria-label="Settings"
      className="flex gap-1 overflow-x-auto border-b px-4 py-2 md:w-48 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:px-2 md:py-4"
    >
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 shrink-0 items-center rounded-md px-3 hover:bg-muted md:h-9",
              active && "bg-primary/10 font-medium text-primary hover:bg-primary/10",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
