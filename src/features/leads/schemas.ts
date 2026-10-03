import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).default("");

export const WORK_TYPES = ["roof_replacement", "roof_repair", "renovation", "gutters", "siding", "other"] as const;

/** The manual lead form. At least a phone or an email is required unless an existing customer is chosen. */
export const leadFormSchema = z
  .object({
    customer_id: z.union([z.literal(""), z.uuid()]).default(""),
    first_name: text(80),
    last_name: text(80),
    phone: text(40),
    email: z.union([z.literal(""), z.email("Enter a valid email")]).default(""),
    address_line1: text(200),
    city: text(100),
    state: text(50),
    postal_code: text(20),
    work_type: z.union([z.literal(""), z.enum(WORK_TYPES)]).default(""),
    source_id: z.union([z.literal(""), z.uuid()]).default(""),
    owner_id: z.union([z.literal(""), z.uuid()]).default(""),
    message: text(4000),
  })
  .superRefine((value, ctx) => {
    if (value.customer_id) return;
    if (!value.first_name) ctx.addIssue({ code: "custom", path: ["first_name"], message: "Enter a first name" });
    if (!value.phone && !value.email) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a phone number or an email" });
    }
  });

export type LeadFormInput = z.infer<typeof leadFormSchema>;

export const logContactSchema = z.object({
  opportunity_id: z.uuid(),
  type: z.enum(["call", "email", "sms"]),
  outcome: z.enum(["connected", "left_voicemail", "no_answer", "sent"]),
  summary: text(2000),
});

export const assignOwnerSchema = z.object({ opportunity_id: z.uuid(), owner_id: z.uuid() });
