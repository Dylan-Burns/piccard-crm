"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const TABS = ["Timeline", "Files", "Tasks", "Details"] as const;
type Tab = (typeof TABS)[number];

/**
 * Phones show one panel at a time behind a segmented control; desktop shows all four in two
 * columns (timeline on the left; tasks, files, details on the right) (spec §5.4).
 */
export function CustomerPanels({ timeline, files, tasks, details }: Record<"timeline" | "files" | "tasks" | "details", React.ReactNode>) {
  const [tab, setTab] = useState<Tab>("Timeline");
  const mobile = (name: Tab) => cn(tab !== name && "hidden", "md:block");

  return (
    <>
      <div role="tablist" aria-label="Customer sections" className="grid grid-cols-4 gap-1 border-b bg-background p-1 md:hidden">
        {TABS.map((name) => (
          <button
            key={name}
            role="tab"
            type="button"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn("h-11 rounded-md", tab === name ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground")}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:p-6">
        <section className={mobile("Timeline")} aria-label="Timeline">
          {timeline}
        </section>
        <div className="space-y-6">
          <section className={mobile("Tasks")} aria-label="Tasks">
            {tasks}
          </section>
          <section className={mobile("Files")} aria-label="Files">
            {files}
          </section>
          <section className={mobile("Details")} aria-label="Details">
            {details}
          </section>
        </div>
      </div>
    </>
  );
}
