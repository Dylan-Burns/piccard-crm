import { z } from "zod";

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Enter your name").max(120),
  phone: optionalText(40),
});

export const changePasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export const ROLES = ["admin", "sales", "field"] as const;

export const inviteSchema = z.object({
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  full_name: z.string().trim().min(1, "Enter a name").max(120),
  role: z.enum(ROLES),
});

export const roleChangeSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(ROLES),
});

export const activeChangeSchema = z.object({
  user_id: z.uuid(),
  is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Form values arrive as strings; tax rate is entered as a percent (8.25) and stored as a fraction (0.0825). */
export const companySchema = z.object({
  company_name: z.string().trim().min(1, "Enter the company name").max(160),
  address_line1: optionalText(),
  city: optionalText(100),
  state: optionalText(50),
  postal_code: optionalText(20),
  phone: optionalText(40),
  email: z
    .union([z.literal(""), z.email("Enter a valid email")])
    .transform((v) => (v === "" ? null : v.trim().toLowerCase())),
  license_number: optionalText(80),
  timezone: z.string().refine(isValidTimeZone, "Choose a valid time zone"),
  default_tax_rate_percent: z.coerce
    .number({ error: "Enter a number" })
    .min(0, "Cannot be negative")
    .lt(100, "Must be under 100%"),
  default_deposit_percent: z.coerce.number({ error: "Enter a number" }).int("Whole number").min(0).max(100),
  estimate_valid_days: z.coerce.number({ error: "Enter a number" }).int("Whole number").min(1).max(365),
  estimate_terms: z.string().max(10000).default(""),
  default_warranty_years: z.coerce.number({ error: "Enter a number" }).int("Whole number").min(0).max(50),
  default_lead_owner_id: z
    .union([z.literal(""), z.uuid()])
    .transform((v) => (v === "" ? null : v)),
  send_inspection_confirmation: z
    .union([z.literal("on"), z.literal("")])
    .optional()
    .transform((v) => v === "on"),
});

export type CompanyInput = z.infer<typeof companySchema>;

/** Percent → fraction with the column's 5-decimal precision. */
export function percentToRate(percent: number): number {
  return Math.round(percent * 1000) / 100000;
}

export function rateToPercent(rate: number): number {
  return Math.round(rate * 100000) / 1000;
}
