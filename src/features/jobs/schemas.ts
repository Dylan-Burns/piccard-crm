import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const JOB_STATUSES = ["pending_schedule", "scheduled", "in_progress", "on_hold", "completed", "cancelled"] as const;
export const PERMIT_STATUSES = ["not_required", "needed", "applied", "approved", "closed"] as const;

export const PERMIT_STATUS_LABELS: Record<(typeof PERMIT_STATUSES)[number], string> = {
  not_required: "Not required",
  needed: "Needed",
  applied: "Applied",
  approved: "Approved",
  closed: "Closed",
};

export const scheduleJobSchema = z
  .object({
    jobId: z.uuid(),
    start: day,
    end: day,
    days: z.array(day).min(1, "Choose at least one work day").max(60),
    assignees: z.array(z.uuid()).min(1, "Choose who is on the crew"),
  })
  .refine((v) => v.end >= v.start, { path: ["end"], message: "The end date must be on or after the start date" });

export const setJobStatusSchema = z.object({ jobId: z.uuid(), status: z.enum(JOB_STATUSES) });

export const updateJobSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Enter a title").max(200),
  permit_status: z.enum(PERMIT_STATUSES),
  permit_number: z.string().trim().max(100).transform((v) => v || null),
  warranty_years: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,2}$/.test(v), "Enter whole years")
    .transform((v) => (v === "" ? null : Number(v))),
  scope_summary: z.string().trim().max(5000).transform((v) => v || null),
});
