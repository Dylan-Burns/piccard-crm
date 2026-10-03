"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { currentProfileWithRole } from "@/lib/auth";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { unwrapRpc } from "@/lib/rpc";
import { getTimeZone } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");
const optionalId = z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null);

const taskSchema = z.object({
  title: z.string().trim().min(1, "Enter what needs doing").max(200),
  description: z.string().trim().max(2000).optional().transform((v) => v || null),
  // <input type="datetime-local"> value, interpreted in the company timezone
  due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Choose a date and time"),
  assigned_to: z.uuid("Choose who is responsible"),
  customer_id: optionalId,
  opportunity_id: optionalId,
  job_id: optionalId,
});

function revalidate(formData: FormData) {
  revalidatePath("/tasks");
  revalidatePath("/leads");
  const path = formData.get("revalidate");
  if (typeof path === "string" && path.startsWith("/")) revalidatePath(path);
}

export async function createTask(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { due_at, job_id, opportunity_id, customer_id, ...rest } = parsed.data;

  const parent = job_id ? { job_id } : opportunity_id ? { opportunity_id } : customer_id ? { customer_id } : {};
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .insert({ ...rest, ...parent, due_at: fromZonedTime(due_at, await getTimeZone()).toISOString() });
  if (error) return fail("insert_failed", "Could not create the task");
  revalidate(formData);
  return ok();
}

const statusSchema = z.object({ task_id: z.uuid(), status: z.enum(["open", "done", "cancelled"]) });

export async function setTaskStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole();
  if (!me) return NOT_ALLOWED;
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Invalid task");

  const supabase = await createClient();
  const result = unwrapRpc(await supabase.rpc("set_task_status", { p_task_id: parsed.data.task_id, p_status: parsed.data.status }));
  if (!result.ok) return result;
  revalidate(formData);
  return ok();
}

const rescheduleSchema = z.object({
  task_id: z.uuid(),
  due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Choose a date and time"),
});

export async function rescheduleTask(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Choose a date and time", fieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ due_at: fromZonedTime(parsed.data.due_at, await getTimeZone()).toISOString() })
    .eq("id", parsed.data.task_id);
  if (error) return fail("update_failed", "Could not move the task");
  revalidate(formData);
  return ok();
}
