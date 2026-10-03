import {
  BarChart3,
  Briefcase,
  CalendarDays,
  CheckSquare,
  Columns3,
  Home,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Database } from "@/types/database";

type UserRole = Database["public"]["Enums"]["user_role"];

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: readonly UserRole[];
};

const STAFF = ["admin", "sales"] as const;
const ALL = ["admin", "sales", "field"] as const;

// Spec §5.1: Dashboard · Leads · Pipeline · Jobs · Calendar · Customers · Reports.
export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: STAFF },
  { href: "/today", label: "Today", icon: Home, roles: ["field"] },
  { href: "/leads", label: "Leads", icon: Inbox, roles: STAFF },
  { href: "/pipeline", label: "Pipeline", icon: Columns3, roles: STAFF },
  { href: "/jobs", label: "Jobs", icon: Briefcase, roles: ALL },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, roles: ALL },
  { href: "/customers", label: "Customers", icon: Users, roles: STAFF },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["admin"] },
];

// Tasks and Settings live in the user menu on desktop (§5.1).
export const MENU_NAV: NavItem[] = [
  { href: "/tasks", label: "Tasks", icon: CheckSquare, roles: ALL },
  { href: "/settings/profile", label: "Settings", icon: Settings, roles: ALL },
];

// Mobile bottom tabs (§5.1). "More" opens a sheet with everything else.
const STAFF_TABS = ["/leads", "/pipeline", "/calendar", "/tasks"];
const FIELD_TABS = ["/today", "/jobs", "/calendar", "/tasks"];

const ALL_ITEMS = [...MAIN_NAV, ...MENU_NAV];

export function navFor(role: UserRole) {
  const main = MAIN_NAV.filter((i) => i.roles.includes(role));
  const menu = MENU_NAV.filter((i) => i.roles.includes(role));
  const tabHrefs = role === "field" ? FIELD_TABS : STAFF_TABS;
  const tabs = tabHrefs.map((href) => ALL_ITEMS.find((i) => i.href === href)).filter((i): i is NavItem => Boolean(i));
  const more = role === "field" ? [] : [...main, ...menu].filter((i) => !tabHrefs.includes(i.href));
  return { main, menu, tabs, more };
}

export function isActive(pathname: string, href: string) {
  if (href.startsWith("/settings")) return pathname.startsWith("/settings");
  return pathname === href || pathname.startsWith(`${href}/`);
}
