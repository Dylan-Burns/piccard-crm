import type { Metadata } from "next";
import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskList, type TaskItem } from "@/components/shared/task-list";
import { PageHeader } from "@/components/shell/page-header";
import { listOpenTasks, type TaskRow } from "@/features/tasks/queries";
import { requireRole } from "@/lib/auth";
import { dueState, formatDateTime } from "@/lib/dates";
import { getTimeZone } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const me = await requireRole();
  const params = await searchParams;
  const isStaff = me.role !== "field";
  const showAll = isStaff && params.who === "all";
  const [tasks, timeZone] = await Promise.all([listOpenTasks(showAll ? null : me.id), getTimeZone()]);

  const toItem = (task: TaskRow): TaskItem => ({
    id: task.id,
    title: task.title,
    dueLabel: formatDateTime(task.due_at, timeZone),
    dueState: dueState(task.due_at, timeZone),
    assignee: showAll ? task.assignee?.full_name : null,
    // Field users cannot open customer pages; staff get a link to the record.
    context:
      isStaff && task.customer
        ? { label: `${task.customer.first_name} ${task.customer.last_name}`.trim(), href: `/customers/${task.customer.id}` }
        : null,
  });
  const items = tasks.map(toItem);
  const groups = [
    { title: "Overdue", items: items.filter((t) => t.dueState === "overdue") },
    { title: "Today", items: items.filter((t) => t.dueState === "today") },
    { title: "Upcoming", items: items.filter((t) => t.dueState === "upcoming") },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <PageHeader
        title="Tasks"
        description={`${items.length} open`}
        actions={
          isStaff ? (
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Whose tasks">
              <Toggle href="/tasks" active={!showAll} label="Mine" />
              <Toggle href="/tasks?who=all" active={showAll} label="Everyone" />
            </div>
          ) : null
        }
      />
      <div className="space-y-6 p-4 md:p-6">
        {groups.length === 0 ? (
          <EmptyState icon={CheckSquare} title="Nothing to do" description="Follow-ups and reminders will show up here." />
        ) : (
          groups.map((group) => (
            <section key={group.title} className="space-y-2">
              <h2 className={cn("font-semibold", group.title === "Overdue" && "text-destructive")}>
                {group.title} <span className="font-normal text-muted-foreground">({group.items.length})</span>
              </h2>
              <TaskList tasks={group.items} revalidate="/tasks" />
            </section>
          ))
        )}
      </div>
    </>
  );
}

function Toggle({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn("flex h-10 items-center rounded px-3 md:h-8", active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground")}
    >
      {label}
    </Link>
  );
}
