"use client";

import Link from "next/link";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NavItem } from "@/components/shell/nav";
import type { ShellUser } from "@/components/shell/app-shell";

const ROLE_LABEL = { admin: "Admin", sales: "Sales", field: "Field" } as const;

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function UserMenu({ user, items, compact = false }: { user: ShellUser; items: NavItem[]; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          compact
            ? "flex size-11 items-center justify-center rounded-md hover:bg-muted"
            : "flex h-11 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-sidebar-accent"
        }
        aria-label="Account menu"
      >
        <Avatar className="size-7">
          <AvatarFallback className="text-xs">{initials(user.fullName)}</AvatarFallback>
        </Avatar>
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{user.fullName}</span>
              <span className="block truncate text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={compact ? "bottom" : "top"} className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{user.fullName}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href}>
                <Icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          {/* Plain <a>, not <Link>: prefetching a sign-out URL would sign the user out. */}
          <a href="/auth/signout">
            <LogOut className="size-4" aria-hidden />
            Sign out
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
