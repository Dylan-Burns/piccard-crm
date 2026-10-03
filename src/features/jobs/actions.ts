"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scheduleJobSchema, setJobStatusSchema, updateJobSchema } from "@/features/jobs/schemas";
import { currentProfileWithRole } from "@/lib/auth";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { unwrapRpc, type RpcResult } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");

function revalidate(jobId: string) {
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/today");
  revalidatePath("/calendar");
  revalidatePath("/tasks");
  revalidatePath("/customers", "layout");
  revalidatePath("/opportunities", "layout");
}

/** Staff edit the descriptive job fields (the only job columns granted for direct update). */
export async function updateJob(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const parsed = updateJobSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update(values).eq("id", id);
  if (error) return error.code === "42501" ? NOT_ALLOWED : fail("update_failed", "Could not save the job");
  revalidate(id);
  return ok();
}

/** Dates, work days, crew, and the move to Scheduled, in one transaction (`schedule_job`). */
export async function scheduleJob(input: unknown): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const parsed = scheduleJobSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the schedule", fieldErrors(parsed.error.issues));
  const { jobId, start, end, days, assignees } = parsed.data;
  const supabase = await createClient();
  const result = unwrapRpc<RpcResult>(await supabase.rpc("schedule_job", { p_job_id: jobId, p_start: start, p_end: end, p_days: days, p_assignees: assignees }));
  if (!result.ok) return result;
  revalidate(jobId);
  return ok();
}

/** Staff: any allowed change. Assigned field users: start and complete only (enforced by `set_job_status`). */
export async function setJobStatus(input: unknown): Promise<ActionResult> {
  if (!(await currentProfileWithRole())) return NOT_ALLOWED;
  const parsed = setJobStatusSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Unknown status");
  const supabase = await createClient();
  const result = unwrapRpc<RpcResult>(await supabase.rpc("set_job_status", { p_job_id: parsed.data.jobId, p_status: parsed.data.status }));
  if (!result.ok) return result;
  revalidate(parsed.data.jobId);
  return ok();
}

const assignSchema = z.object({ jobId: z.uuid(), userIds: z.array(z.uuid()).min(1).max(20) });

/** Adds people to the crew without touching the schedule. */
export async function assignUsers(input: unknown): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Choose who to add");
  const supabase = await createClient();
  const { error } = await supabase
    .from("job_assignments")
    .upsert(parsed.data.userIds.map((user_id) => ({ job_id: parsed.data.jobId, user_id })), { onConflict: "job_id,user_id", ignoreDuplicates: true });
  if (error) return error.code === "42501" ? NOT_ALLOWED : fail("failed", "Could not update the crew");
  revalidate(parsed.data.jobId);
  return ok();
}

/** Removes one person from the crew. Their remaining work days are changed from Schedule job. */
export async function unassignUser(input: unknown): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin", "sales"))) return NOT_ALLOWED;
  const parsed = z.object({ jobId: z.uuid(), userId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("invalid", "Unknown crew member");
  const supabase = await createClient();
  const { error } = await supabase.from("job_assignments").delete().eq("job_id", parsed.data.jobId).eq("user_id", parsed.data.userId);
  if (error) return error.code === "42501" ? NOT_ALLOWED : fail("failed", "Could not update the crew");
  revalidate(parsed.data.jobId);
  return ok();
}
