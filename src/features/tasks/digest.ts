import "server-only";
import { businessDate, dueState } from "@/lib/dates";
import { appUrl } from "@/lib/env";
import { sendEmail, type Sender } from "@/lib/integrations/resend";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily digest (spec §6.4): one email per user who has overdue or due-today tasks.
 * Deduped per user per business day, so running the cron twice sends once.
 */
export async function sendTaskDigests(send?: Sender, now: Date = new Date()): Promise<{ users: number; sent: number }> {
  const db = createAdminClient();
  const { data: settings } = await db.from("company_settings").select("timezone").maybeSingle();
  const timeZone = settings?.timezone ?? "America/New_York";
  const today = businessDate(now, timeZone);

  // Everything due up to 36 hours ahead covers "today" in any timezone; filter precisely below.
  const horizon = new Date(now.getTime() + 36 * 3_600_000).toISOString();
  const { data: tasks, error } = await db
    .from("tasks")
    .select("title, due_at, assigned_to, assignee:profiles!tasks_assigned_to_fkey(full_name, email, is_active), customer:customers(first_name, last_name)")
    .eq("status", "open")
    .lt("due_at", horizon)
    .order("due_at");
  if (error) throw error;

  const byUser = new Map<string, { name: string; email: string; overdue: { title: string; context: string }[]; today: { title: string; context: string }[] }>();
  for (const task of tasks) {
    if (!task.assignee?.is_active) continue;
    const state = dueState(task.due_at, timeZone, now);
    if (state === "upcoming") continue;
    const entry = byUser.get(task.assigned_to) ?? { name: task.assignee.full_name, email: task.assignee.email, overdue: [], today: [] };
    const item = { title: task.title, context: task.customer ? `${task.customer.first_name} ${task.customer.last_name}`.trim() : "" };
    (state === "overdue" ? entry.overdue : entry.today).push(item);
    byUser.set(task.assigned_to, entry);
  }

  let sent = 0;
  for (const [userId, entry] of byUser) {
    const result = await sendEmail(
      {
        dedupeKey: `digest:${userId}:${today}`,
        template: "task_digest",
        to: entry.email,
        subject: `${entry.overdue.length} overdue, ${entry.today.length} due today`,
        props: { name: entry.name.split(" ")[0] ?? entry.name, overdue: entry.overdue.slice(0, 25), today: entry.today.slice(0, 25), url: `${appUrl()}/tasks` },
      },
      send,
    );
    if (result === "sent") sent += 1;
  }
  return { users: byUser.size, sent };
}
