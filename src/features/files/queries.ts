import "server-only";
import { BUCKET } from "@/features/files/categories";
import { listFilesFor, type FileItem } from "@/features/files/storage";
import type { Profile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Files for a customer or a deal, with signed URLs, as far as the signed-in user may see them. */
export async function listFiles(profile: Profile, scope: { customerId: string } | { opportunityId: string }): Promise<FileItem[]> {
  return listFilesFor({ supabase: await createClient(), profile }, scope);
}

/** Signed URL for the company logo, or null when none is set. Callers gate on role. */
export async function getCompanyLogoUrl(logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  const { data } = await createAdminClient().storage.from(BUCKET).createSignedUrl(logoPath, 3600);
  return data?.signedUrl ?? null;
}
