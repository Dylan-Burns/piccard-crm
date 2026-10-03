"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserMenu } from "@/components/shell/user-menu";
import { isActive, navFor, type NavItem } from "@/components/shell/nav";
import type { Database } from "@/types/database";

type UserRole = Database["public"]["Enums"]["user_role"];

export type ShellUser = { fullName: string; email: string; role: UserRole };

export function AppShell({ user, companyName, children }: { user: ShellUser; companyName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const nav = navFor(user.role);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b px-4 font-semibold text-foreground">{companyName}</div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 p-2">
          {nav.main.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </nav>
        <div className="border-t p-2">
          <UserMenu user={user} items={nav.menu} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b bg-background px-4 md:hidden">
          <span className="truncate font-semibold">{companyName}</span>
          <UserMenu user={user} items={nav.menu} compact />
        </header>

        {/* pb clears the fixed bottom tab bar on mobile, including the iOS home indicator */}
        <main className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      </div>

      <BottomTabs tabs={nav.tabs} more={nav.more} pathname={pathname} />
    </div>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
        active && "bg-primary/10 font-medium text-primary hover:bg-primary/10",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {item.label}
    </Link>
  );
}

function BottomTabs({ tabs, more, pathname }: { tabs: NavItem[]; more: NavItem[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const moreActive = more.some((i) => isActive(pathname, i.href));

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((item) => (
        <TabLink key={item.href} item={item} active={isActive(pathname, item.href)} />
      ))}
      {more.length > 0 ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground",
              moreActive && "text-primary",
            )}
          >
            <MoreHorizontal className="size-5" aria-hidden />
            More
          </button>
          <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
            <SheetHeader>
              <SheetTitle>More</SheetTitle>
            </SheetHeader>
            <div className="grid gap-1 px-4 pb-4">
              {more.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex h-12 items-center gap-3 rounded-md px-3 hover:bg-muted",
                      isActive(pathname, item.href) && "font-medium text-primary",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </nav>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground",
        active && "font-medium text-primary",
      )}
    >
      <Icon className="size-5" aria-hidden />
      {item.label}
    </Link>
  );
}
