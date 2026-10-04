import { z } from "zod";
import { parseDollarsToCents } from "@/lib/money";

const dollars = (message: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const cents = parseDollarsToCents(v === "" ? "0" : v);
      if (cents === null || cents > 2_000_000_000) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return cents;
    });

export const UNITS = ["sq", "lf", "ea", "hr"] as const;

export const lineSchema = z.object({
  name: z.string().trim().min(1, "Every line needs a name").max(300),
  description: z.string().trim().max(2000).default(""),
  quantity: z.number().positive("Quantity must be above zero").max(99_999_999).refine((q) => Math.abs(q * 100 - Math.round(q * 100)) < 1e-6, "Quantity can have two decimals"),
  unit: z.string().trim().min(1).max(20),
  unitPriceCents: z.number().int().min(0).max(999_999_999),
  isTaxable: z.boolean(),
});
export type LineInput = z.infer<typeof lineSchema>;

export const saveLinesSchema = z.object({ estimateId: z.uuid(), lines: z.array(lineSchema).max(200) });

/** Header fields a user may edit on a draft (the columns granted for update, spec §2.10). */
export const updateEstimateSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Enter a title").max(200),
  scope_notes: z.string().trim().max(5000).transform((v) => v || null),
  terms: z.string().trim().max(20_000),
  discount: dollars("Enter the discount in dollars"),
  tax_percent: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,2}(\.\d{1,3})?$/.test(v) && Number(v) < 100), "Enter a rate such as 8.25")
    .transform((v) => Math.round(Number(v || "0") * 1000) / 100_000),
  deposit_percent: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,3}$/.test(v) && Number(v) <= 100), "Enter a whole percent from 0 to 100")
    .transform((v) => Number(v || "0")),
  valid_until: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => v || null),
});

export const priceBookItemSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  description: z.string().trim().max(1000).transform((v) => v || null),
  unit: z.string().trim().min(1, "Enter a unit").max(20),
  price: dollars("Enter a price such as 425.00"),
  is_taxable: z.union([z.literal("on"), z.literal("")]).optional().transform((v) => v === "on"),
});
