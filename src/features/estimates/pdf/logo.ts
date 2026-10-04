import "server-only";
import { BUCKET } from "@/features/files/categories";
import type { EstimateDocumentData } from "@/features/estimates/pdf/data";
import { createAdminClient } from "@/lib/supabase/admin";

/** The company logo as bytes for the PDF. WebP is skipped: the PDF renderer reads PNG and JPEG only. */
export async function loadLogo(logoPath: string | null): Promise<EstimateDocumentData["company"]["logo"]> {
  const format = logoPath?.endsWith(".png") ? "png" : logoPath?.endsWith(".jpg") ? "jpg" : null;
  if (!logoPath || !format) return null;
  const { data } = await createAdminClient().storage.from(BUCKET).download(logoPath);
  return data ? { data: Buffer.from(await data.arrayBuffer()), format } : null;
}
