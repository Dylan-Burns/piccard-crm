import "server-only";
import { createClient } from "@/lib/supabase/server";

const TASK_COLUMNS = `id, title, description, due_at, status, assigned_to, auto_key, customer_id, opportunity_id, job_id,
  assignee:profiles!tasks_assigned_to_fkey(full_name),
  customer:customers(id, first_name, last_name),
  opportunity:opportunities(title)`;

/** Open tasks for one user, or for everyone when userId is null (staff only; RLS still applies). */
export async function listOpenTasks(userId: string | null) {
  const supabase = await createClient();
  let query = supabase.from("tasks").select(TASK_COLUMNS).eq("status", "open").order("due_at").range(0, 199);
  if (userId) query = query.eq("assigned_to", userId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export type TaskRow = Awaited<ReturnType<typeof listOpenTasks>>[number];
