"use client";

import { useState } from "react";
import { CalendarDays, FileText, Mail, Paperclip, Phone, Receipt, StickyNote, Zap, type LucideIcon } from "lucide-react";
import { Timeline, type TimelineItem } from "@/components/shared/timeline";
import { HISTORY_FILTERS, type HistoryFilter, type HistoryKind } from "@/features/opportunities/history";
import { cn } from "@/lib/utils";

/** Composer tabs, in display order. Each one also selects the history shown beneath it. */
const TABS = [
  { key: "activity", label: "Activity", icon: Zap, filter: "all" },
  { key: "notes", label: "Notes", icon: StickyNote, filter: "notes" },
  { key: "appointments", label: "Appointments", icon: CalendarDays, filter: "activities" },
  { key: "call", label: "Call", icon: Phone, filter: "activities" },
  { key: "email", label: "Email", icon: Mail, filter: "emails" },
  { key: "files", label: "Files", icon: Paperclip, filter: "files" },
  { key: "estimates", label: "Estimates", icon: FileText, filter: "estimates" },
  { key: "invoices", label: "Invoices", icon: Receipt, filter: "invoices" },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon; filter: HistoryFilter }[];
export type DealTab = (typeof TABS)[number]["key"];

export type HistoryItem = TimelineItem & { kind: HistoryKind };

/**
 * The working area of the deal page: a tab bar whose tabs each hold the form for adding that kind
 * of thing, a Focus block with what is due next, and the history, filtered by chips. Choosing a
 * tab also filters the history to match; the chips can then be changed on their own.
 */
export function DealWorkspace({ panels, focus, history }: { panels: Record<DealTab, React.ReactNode>; focus: React.ReactNode; history: HistoryItem[] }) {
  const [tab, setTab] = useState<DealTab>("activity");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const counts = new Map<HistoryFilter, number>([["all", history.length]]);
  for (const item of history) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const shown = filter === "all" ? history : history.filter((item) => item.kind === filter);

  function choose(next: (typeof TABS)[number]) {
    setTab(next.key);
    setFilter(next.filter);
  }

  return (
    <div className="space-y-6">
      <section aria-label="Add to this deal" className="rounded-md border">
        <div role="tablist" aria-label="What to add" className="flex overflow-x-auto border-b">
          {TABS.map((item) => {
            const Icon = item.icon;
            const selected = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`deal-tab-${item.key}`}
                aria-selected={selected}
                aria-controls={`deal-panel-${item.key}`}
                onClick={() => choose(item)}
                className={cn(
                  "-mb-px flex h-11 shrink-0 items-center gap-1 border-b-2 px-2.5 md:h-10 md:px-2 lg:px-2.5",
                  selected ? "border-primary bg-primary/5 font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
        {TABS.map((item) => (
          <div key={item.key} role="tabpanel" id={`deal-panel-${item.key}`} aria-labelledby={`deal-tab-${item.key}`} hidden={tab !== item.key} className="p-3">
            {panels[item.key]}
          </div>
        ))}
      </section>

      <section aria-label="Focus" className="space-y-3">
        <h2 className="font-semibold">Focus</h2>
        {focus}
      </section>

      <section aria-label="History" className="space-y-3">
        <h2 className="font-semibold">History</h2>
        <div role="group" aria-label="Filter history" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {HISTORY_FILTERS.map((item) => {
            const count = counts.get(item.key) ?? 0;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
                className={cn(
                  "flex h-11 shrink-0 items-center rounded-md px-2.5 text-xs font-medium md:h-7",
                  filter === item.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {item.label}
                {item.key === "all" ? null : <span className="ml-1 tabular">({count})</span>}
              </button>
            );
          })}
        </div>
        <Timeline items={shown} emptyText={filter === "all" ? "Nothing has happened yet." : "Nothing of this kind yet."} />
      </section>
    </div>
  );
}
