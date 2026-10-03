"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BUCKET } from "@/features/files/categories";
import { createUploadUrlsSchema, registerFilesSchema, updateFileSchema } from "@/features/files/schemas";
import {
  createUploadSlots,
  registerUploadedFiles,
  removeFile,
  signFiles,
  updateFileDetails,
  type FileContext,
  type FileItem,
  type UploadSlot,
} from "@/features/files/storage";
import { currentProfileWithRole } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");
const INVALID_MESSAGE = "That file cannot be uploaded";

async function context(...roles: Parameters<typeof currentProfileWithRole>): Promise<FileContext | null> {
  const profile = await currentProfileWithRole(...roles);
  if (!profile) return null;
  return { supabase: await createClient(), profile };
}

function revalidate(opportunityId?: string | null) {
  revalidatePath("/customers", "layout");
  revalidatePath("/today");
  if (opportunityId) revalidatePath(`/opportunities/${opportunityId}`);
}

/** Step 1 of an upload: the server picks ids and paths and returns signed upload URLs. */
export async function createUploadUrls(input: unknown): Promise<ActionResult<{ uploads: UploadSlot[] }>> {
  const ctx = await context();
  if (!ctx) return NOT_ALLOWED;
  const parsed = createUploadUrlsSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? INVALID_MESSAGE);
  return createUploadSlots(ctx, parsed.data);
}

/** Step 2: record the uploaded objects. One call per batch, so the timeline gets one entry. */
export async function registerFiles(input: unknown): Promise<ActionResult<{ count: number }>> {
  const ctx = await context();
  if (!ctx) return NOT_ALLOWED;
  const parsed = registerFilesSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", INVALID_MESSAGE);
  const result = await registerUploadedFiles(ctx, parsed.data);
  if (result.ok) revalidate(parsed.data.opportunityId);
  return result;
}

/** Fresh signed URLs for files the caller can read (links expire after an hour). */
export async function getSignedUrls(fileIds: unknown): Promise<ActionResult<{ files: FileItem[] }>> {
  const ctx = await context();
  if (!ctx) return NOT_ALLOWED;
  const parsed = z.array(z.uuid()).max(500).safeParse(fileIds);
  if (!parsed.success) return fail("invalid", "Unknown files");
  return ok({ files: await signFiles(ctx, parsed.data) });
}

export async function updateFile(input: unknown): Promise<ActionResult> {
  const ctx = await context("admin", "sales");
  if (!ctx) return NOT_ALLOWED;
  const parsed = updateFileSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the category and caption");
  const result = await updateFileDetails(ctx, parsed.data);
  if (result.ok) {
    revalidate();
    revalidatePath("/opportunities", "layout");
  }
  return result;
}

export async function deleteFile(fileId: unknown): Promise<ActionResult> {
  const ctx = await context("admin");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z.uuid().safeParse(fileId);
  if (!parsed.success) return fail("invalid", "Unknown file");
  const result = await removeFile(ctx, parsed.data);
  if (result.ok) {
    revalidate();
    revalidatePath("/opportunities", "layout");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Company logo (admin). Stored in the same private bucket under `_company/`.
// ---------------------------------------------------------------------------

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const LOGO_PATH = /^_company\/logo-[0-9a-f-]{36}\.(png|jpg|webp)$/;
const logoSchema = z.object({ type: z.string(), size: z.number().int().positive().max(2 * 1024 * 1024) });

export async function createLogoUploadUrl(input: unknown): Promise<ActionResult<{ storagePath: string; signedUrl: string }>> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  const parsed = logoSchema.safeParse(input);
  const extension = parsed.success ? LOGO_TYPES[parsed.data.type] : undefined;
  if (!parsed.success || !extension) return fail("invalid", "Use a PNG, JPG, or WebP image up to 2 MB");
  const storagePath = `_company/logo-${randomUUID()}.${extension}`;
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return fail("storage_failed", "Could not start the upload. Please try again.");
  return ok({ storagePath, signedUrl: data.signedUrl });
}

/** Points the company at an uploaded logo (or clears it with null) and removes the previous object. */
export async function setCompanyLogo(storagePath: string | null): Promise<ActionResult> {
  if (!(await currentProfileWithRole("admin"))) return NOT_ALLOWED;
  if (storagePath !== null && !LOGO_PATH.test(storagePath)) return fail("invalid", "Unknown logo");
  const supabase = await createClient();
  const storage = createAdminClient().storage.from(BUCKET);
  if (storagePath) {
    const { data: exists } = await storage.exists(storagePath);
    if (!exists) return fail("not_uploaded", "The logo did not finish uploading. Try it again.");
  }
  const { data: before } = await supabase.from("company_settings").select("logo_path").eq("id", true).single();
  const { error } = await supabase.from("company_settings").update({ logo_path: storagePath }).eq("id", true);
  if (error) return fail("update_failed", "Could not save the logo");
  if (before?.logo_path && before.logo_path !== storagePath && LOGO_PATH.test(before.logo_path)) {
    await storage.remove([before.logo_path]);
  }
  revalidatePath("/settings/company");
  return ok();
}
