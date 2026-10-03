import { z } from "zod";

// Spec §6.8. Integration variables are optional so the app boots without them.

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url().optional(),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(16).optional(),
  LEAD_WEBHOOK_SECRET: z.string().min(16).optional(),
  GOOGLE_ADS_WEBHOOK_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  INTEGRATION_ENCRYPTION_KEY: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  QBO_CLIENT_ID: z.string().min(1).optional(),
  QBO_CLIENT_SECRET: z.string().min(1).optional(),
  QBO_ENVIRONMENT: z.enum(["sandbox", "production"]).optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function format(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicSchema.safeParse(source);
  if (!result.success) throw new Error(`Invalid public environment: ${format(result.error)}`);
  return result.data;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(source);
  if (!result.success) throw new Error(`Invalid server environment: ${format(result.error)}`);
  return result.data;
}

// NEXT_PUBLIC_* must be referenced literally so Next.js inlines them into client bundles.
export function publicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
}

let cachedServerEnv: ServerEnv | undefined;

/** Server-only. Parsed lazily so importing this module never throws at build time. */
export function serverEnv(): ServerEnv {
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}

/** Absolute base URL of the app, for links in emails and redirects. */
export function appUrl(): string {
  const env = publicEnv();
  if (env.NEXT_PUBLIC_APP_URL) return env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
