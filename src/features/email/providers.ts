import "server-only";
import { serverEnv } from "@/lib/env";
import type { EmailProvider } from "@/lib/integrations/email/types";

export const EMAIL_PROVIDER_LABELS: Record<EmailProvider, string> = { google: "Google", microsoft: "Microsoft 365" };

export function isEmailProvider(value: string): value is EmailProvider {
  return value === "google" || value === "microsoft";
}

/** Whether the app has the credentials to sign users in with this provider. */
export function emailProviderReady(provider: EmailProvider): boolean {
  const env = serverEnv();
  if (!env.INTEGRATION_ENCRYPTION_KEY) return false;
  return provider === "google" ? Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) : Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.MICROSOFT_TENANT_ID);
}
