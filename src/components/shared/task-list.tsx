"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Circle } from "lucide-react";
import { useActionToast } from "@/components/shared/use-action-toast";
import { setTaskStatus } from "@/features/tasks/actions";
import { cn } from "@/lib/utils";

export type TaskItem = {
  id: string;
  title: string;
  /** Preformatted on the server in the company timezone, e.g. "Oct 7, 10:00 AM". */
  dueLabel: string;
  dueState: "overdue" | "today" | "upcoming";
  assignee?: string | null;
  context?: { label: string; href: string } | null;
};

export function TaskList({ tasks, revalidate, emptyText = "No open tasks." }: { tasks: TaskItem[]; revalidate: string; emptyText?: string }) {
  if (tasks.length === 0) return <p className="text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y rounded-md border bg-card">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} revalidate={revalidate} />
      ))}
    </ul>
  );
}

function TaskRow({ task, revalidate }: { task: TaskItem; revalidate: string }) {
  const [state, action, pending] = useActionState(setTaskStatus, null);
  useActionToast(state, "Task completed");

  return (
    <li className={cn("flex items-start gap-1 pr-3", pending && "opacity-50")}>
      <form action={action}>
        <input type="hidden" name="task_id" value={task.id} />
        <input type="hidden" name="status" value="done" />
        <input type="hidden" name="revalidate" value={revalidate} />
        <button
          type="submit"
          disabled={pending}
          aria-label={`Complete: ${task.title}`}
          className="flex size-11 items-center justify-center text-muted-foreground hover:text-primary"
        >
          <Circle className="size-5" aria-hidden />
        </button>
      </form>
      <div className="min-w-0 flex-1 py-2.5">
        <p className="truncate font-medium">{task.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className={cn(task.dueState === "overdue" && "font-medium text-destructive", task.dueState === "today" && "text-warning")}>
            {task.dueState === "overdue" ? "Overdue · " : ""}
            {task.dueLabel}
          </span>
          {task.assignee ? ` · ${task.assignee}` : ""}
          {task.context ? (
            <>
              {" · "}
              <Link href={task.context.href} className="hover:underline">
                {task.context.label}
              </Link>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}
