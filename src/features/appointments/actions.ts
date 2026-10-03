"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { currentProfileWithRole } from "@/lib/auth";
import { sendEmail } from "@/lib/integrations/resend";
import { formatPhone } from "@/lib/phone";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { unwrapRpc, type RpcResult } from "@/lib/rpc";
import { getTimeZone } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Choose a time");

function revalidate(opportunityId?: string | null) {
  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/pipeline");
  revalidatePath("/tasks");
  if (opportunityId) revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/customers", "layout");
}

/** Emails the customer about a scheduled or moved inspection, if the setting is on and they have an email. */
async function sendInspectionConfirmation(appointmentId: string, rescheduled: boolean) {
  const db = createAdminClient();
  const [{ data: a }, { data: settings }] = await Promise.all([
    db
      .from("appointments")
      .select("id, type, status, starts_at, opportunity_id, customer:customers(first_name, email), property:properties(address_line1, city)")
      .eq("id", appointmentId)
      .maybeSingle(),
    db.from("company_settings").select("company_name, phone, timezone, send_inspection_confirmation").maybeSingle(),
  ]);
  if (!a || a.type !== "inspection" || a.status !== "scheduled" || !a.customer?.email || !settings?.send_inspection_confirmation) return;
  const when = formatInTimeZone(a.starts_at, settings.timezone, "EEEE, MMMM d 'at' h:mm a");
  await sendEmail({
    dedupeKey: `inspection:${a.id}:${new Date(a.starts_at).getTime()}`,
    template: "inspection_confirmation",
    to: a.customer.email,
    subject: rescheduled ? `Your inspection has moved to ${when}` : `Your inspection is scheduled for ${when}`,
    props: {
      customerName: a.customer.first_name,
      when,
      address: a.property ? [a.property.address_line1, a.property.city].filter(Boolean).join(", ") : "",
      companyName: settings.company_name,
      companyPhone: formatPhone(settings.phone),
      rescheduled,
    },
    opportunityId: a.opportunity_id,
  });
}

const scheduleSchema = z.object({
  opportunity_id: z.union([z.literal(""), z.uuid()]).optional(),
  job_id: z.union([z.literal(""), z.uuid()]).optional(),
  type: z.enum(["inspection", "estimate_presentation", "job_work", "other"]),
  date: day,
  time,
  duration: z.coerce.number().int().min(15).max(24 * 60),
  assigned_to: z.uuid("Choose who is going"),
  notes: z.string().trim().max(2000).optional(),
});

export async function scheduleAppointment(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = scheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const input = parsed.data;
  if (!input.opportunity_id && !input.job_id) return fail("invalid", "Choose a deal", { opportunity_id: "Choose a deal" });

  const starts = fromZonedTime(`${input.date}T${input.time}:00`, await getTimeZone());
  const supabase = await createClient();
  const result = unwrapRpc<RpcResult & { appointment_id: string }>(
    await supabase.rpc("schedule_appointment", {
      p: {
        opportunity_id: input.opportunity_id ?? "",
        job_id: input.job_id ?? "",
        type: input.type,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + input.duration * 60_000).toISOString(),
        assigned_to: input.assigned_to,
        notes: input.notes ?? "",
      },
    }),
  );
  if (!result.ok) return result;
  const id = result.data.appointment_id;
  after(() => sendInspectionConfirmation(id, false));
  revalidate(input.opportunity_id);
  return ok();
}

const rescheduleSchema = z.object({
  appointment_id: z.uuid(),
  opportunity_id: z.string().optional(),
  date: day,
  time,
  duration: z.coerce.number().int().min(15).max(24 * 60),
  assigned_to: z.union([z.literal(""), z.uuid()]).optional(),
});

export async function rescheduleAppointment(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const input = parsed.data;

  const starts = fromZonedTime(`${input.date}T${input.time}:00`, await getTimeZone());
  const supabase = await createClient();
  const result = unwrapRpc(
    await supabase.rpc("reschedule_appointment", {
      p_appointment_id: input.appointment_id,
      p_starts_at: starts.toISOString(),
      p_ends_at: new Date(starts.getTime() + input.duration * 60_000).toISOString(),
      ...(input.assigned_to ? { p_assigned_to: input.assigned_to } : {}),
    }),
  );
  if (!result.ok) return result;
  after(() => sendInspectionConfirmation(input.appointment_id, true));
  revalidate(input.opportunity_id);
  return ok();
}

/** Drag-to-reschedule on the calendar: same local time, different day. */
export async function moveAppointmentToDay(input: { appointmentId: string; day: string; time: string; durationMinutes: number }): Promise<ActionResult> {
  const formData = new FormData();
  formData.set("appointment_id", input.appointmentId);
  formData.set("date", input.day);
  formData.set("time", input.time);
  formData.set("duration", String(input.durationMinutes));
  return rescheduleAppointment(null, formData);
}

const closeSchema = z.object({
  appointment_id: z.uuid(),
  opportunity_id: z.string().optional(),
  intent: z.enum(["completed", "no_show", "cancel"]),
  notes: z.string().trim().max(2000).optional(),
});

/** Complete, no-show (the assignee or staff), or cancel (staff). */
export async function closeAppointment(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole();
  if (!me) return NOT_ALLOWED;
  const parsed = closeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Invalid request");
  const { appointment_id, opportunity_id, intent, notes } = parsed.data;

  const supabase = await createClient();
  const result = unwrapRpc(
    intent === "cancel"
      ? await supabase.rpc("cancel_appointment", { p_appointment_id: appointment_id, p_reason: notes ?? "" })
      : await supabase.rpc("complete_appointment", { p_appointment_id: appointment_id, p_status: intent, p_outcome_notes: notes ?? "" }),
  );
  if (!result.ok) return result;
  revalidate(opportunity_id);
  return ok();
}
