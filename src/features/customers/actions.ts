"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentProfileWithRole } from "@/lib/auth";
import { toE164 } from "@/lib/phone";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");
const blankToNull = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v));

const customerSchema = z
  .object({
    customer_id: z.uuid(),
    first_name: z.string().trim().min(1, "Enter a first name").max(80),
    last_name: z.string().trim().max(80),
    company_name: blankToNull(160),
    phone: blankToNull(40),
    secondary_phone: blankToNull(40),
    email: z.union([z.literal(""), z.email("Enter a valid email")]).transform((v) => (v === "" ? null : v.trim().toLowerCase())),
    preferred_contact: z.union([z.literal(""), z.enum(["call", "text", "email"])]).transform((v) => v || null),
  })
  .refine((v) => v.phone || v.email, { path: ["phone"], message: "Keep at least a phone number or an email" });

export async function updateCustomer(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { customer_id, ...values } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ ...values, phone_e164: toE164(values.phone) })
    .eq("id", customer_id);
  if (error) return fail("update_failed", "Could not save the customer");
  revalidatePath(`/customers/${customer_id}`);
  revalidatePath("/customers");
  return ok();
}

const propertySchema = z.object({
  customer_id: z.uuid(),
  property_id: z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null),
  label: blankToNull(80),
  address_line1: z.string().trim().min(1, "Enter the street address").max(200),
  address_line2: blankToNull(200),
  city: blankToNull(100),
  state: blankToNull(50),
  postal_code: blankToNull(20),
  access_notes: blankToNull(1000),
});

/** Adds a property, or updates one when property_id is present. */
export async function saveProperty(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole("admin", "sales");
  if (!me) return NOT_ALLOWED;
  const parsed = propertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("invalid", "Check the highlighted fields", fieldErrors(parsed.error.issues));
  const { customer_id, property_id, ...values } = parsed.data;

  const supabase = await createClient();
  const { error } = property_id
    ? await supabase.from("properties").update(values).eq("id", property_id).eq("customer_id", customer_id)
    : await supabase.from("properties").insert({ ...values, customer_id });
  if (error) return fail("save_failed", "Could not save the property");
  revalidatePath(`/customers/${customer_id}`);
  return ok();
}
