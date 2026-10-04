import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET, contentMatchesType, extensionFor, isImage, type FileCategory } from "@/features/files/categories";
import type { CreateUploadUrlsInput, RegisterFilesInput } from "@/features/files/schemas";
import type { UserRole } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/result";
import { unwrapRpc, type RpcResult } from "@/lib/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Storage access (spec §3.4). The bucket has no policies: the user's own client decides which
 * `files` rows and deals are visible (RLS), and the service client only signs paths for them.
 * Functions take the caller's client and profile so they can be tested without a request.
 */
export type FileContext = { supabase: SupabaseClient<Database>; profile: { id: string; role: UserRole } };

const NOT_ALLOWED = fail("forbidden", "You do not have permission to do that");
const SIGNED_URL_SECONDS = 3600;
const THUMBNAIL = { width: 400, height: 400, resize: "cover" as const, quality: 70 };

type Target = { opportunityId?: string; customerId?: string; jobId?: string; appointmentId?: string };

/**
 * Finds the customer behind an upload target, or null when the caller may not upload there.
 * Staff may use any deal or customer. Field users need a deal they are assigned to through a
 * live appointment or a job; they cannot read `opportunities`, so the lookup goes through those tables.
 */
async function resolveTarget({ supabase, profile }: FileContext, target: Target): Promise<{ customerId: string; opportunityId: string | null } | null> {
  const { opportunityId, customerId, jobId, appointmentId } = target;
  let resolved: { customerId: string; opportunityId: string | null } | null = null;

  if (jobId) {
    // RLS returns the job to staff and to field users assigned to it.
    const { data } = await supabase.from("jobs").select("customer_id, opportunity_id").eq("id", jobId).maybeSingle();
    if (data) resolved = { customerId: data.customer_id, opportunityId: data.opportunity_id };
  } else if (profile.role === "field") {
    if (!opportunityId) return null;
    const { data: appointment } = await supabase
      .from("appointments")
      .select("customer_id")
      .eq("opportunity_id", opportunityId)
      .eq("assigned_to", profile.id)
      .in("status", ["scheduled", "completed"])
      .limit(1)
      .maybeSingle();
    const { data: job } = appointment ? { data: null } : await supabase.from("jobs").select("customer_id").eq("opportunity_id", opportunityId).limit(1).maybeSingle();
    const found = appointment ?? job;
    if (found) resolved = { customerId: found.customer_id, opportunityId };
  } else if (opportunityId) {
    const { data } = await supabase.from("opportunities").select("customer_id").eq("id", opportunityId).maybeSingle();
    if (data) resolved = { customerId: data.customer_id, opportunityId };
  } else if (customerId) {
    const { data } = await supabase.from("customers").select("id").eq("id", customerId).maybeSingle();
    if (data) resolved = { customerId: data.id, opportunityId: null };
  }
  if (!resolved) return null;

  if (appointmentId) {
    const { data } = await supabase.from("appointments").select("opportunity_id").eq("id", appointmentId).maybeSingle();
    if (!data || data.opportunity_id !== resolved.opportunityId) return null;
  }
  return resolved;
}

export type UploadSlot = { id: string; storagePath: string; signedUrl: string };

/** Generates ids and paths, and returns one signed upload URL per file, in the order given. */
export async function createUploadSlots(ctx: FileContext, input: CreateUploadUrlsInput): Promise<ActionResult<{ uploads: UploadSlot[] }>> {
  const target = await resolveTarget(ctx, input);
  if (!target) return NOT_ALLOWED;

  const storage = createAdminClient().storage.from(BUCKET);
  const uploads: UploadSlot[] = [];
  for (const file of input.files) {
    const extension = extensionFor(file.type);
    if (!extension) return fail("invalid", "Only photos and PDFs can be uploaded");
    const id = randomUUID();
    const storagePath = `${target.customerId}/${target.opportunityId ?? "_"}/${id}.${extension}`;
    const { data, error } = await storage.createSignedUploadUrl(storagePath);
    if (error || !data) return fail("storage_failed", "Could not start the upload. Please try again.");
    uploads.push({ id, storagePath, signedUrl: data.signedUrl });
  }
  return ok({ uploads });
}

/**
 * Reads the first bytes of each stored object and compares them with the declared type. Storage
 * only checks the type the uploader claimed, so this is where the content itself is looked at.
 * Anything that cannot be read counts as a failure. Nothing is deleted here: a path supplied by
 * the caller may belong to a file that is already registered.
 */
async function inspectContent(files: { storagePath: string; type: string }[]): Promise<"ok" | "missing" | "invalid"> {
  const storage = createAdminClient().storage.from(BUCKET);
  const results = await Promise.all(
    files.map(async (file): Promise<"ok" | "missing" | "invalid"> => {
      // Each object is looked up by its exact path, so the cost does not grow with the size of the folder.
      const { data } = await storage.createSignedUrl(file.storagePath, 60);
      if (!data?.signedUrl) return "missing";
      const response = await fetch(data.signedUrl, { headers: { Range: "bytes=0-15" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!response) return "invalid";
      if (response.status === 404 || response.status === 400) return "missing";
      if (!response.ok) return "invalid";
      // Read at most the first chunk, whether or not the server honoured the range.
      const reader = response.body?.getReader();
      const first = reader ? await reader.read() : null;
      void reader?.cancel();
      return first?.value && contentMatchesType(first.value.slice(0, 16), file.type) ? "ok" : "invalid";
    }),
  );
  return results.includes("invalid") ? "invalid" : results.includes("missing") ? "missing" : "ok";
}

/**
 * Records uploaded objects. Order matters: confirm the caller may upload to the target, confirm
 * every path is under that target, inspect the content, mark the objects as inspected (service
 * role), then call `register_files` as the user. The RPC refuses unmarked objects, so calling it
 * directly cannot skip the inspection.
 */
export async function registerUploadedFiles(ctx: FileContext, input: RegisterFilesInput): Promise<ActionResult<{ count: number }>> {
  const target = await resolveTarget(ctx, input);
  if (!target) return NOT_ALLOWED;
  const prefix = `${target.customerId}/${target.opportunityId ?? "_"}/`;
  if (input.files.some((f) => f.storagePath !== `${prefix}${f.id}.${extensionFor(f.type)}`)) return fail("invalid", "One of the files is not valid");

  const admin = createAdminClient();
  const paths = input.files.map((f) => f.storagePath);
  // Files that are already registered were inspected then; do not re-judge them under a new declared type.
  const { data: existing } = await admin.from("files").select("storage_path").in("storage_path", paths);
  const registered = new Set((existing ?? []).map((r) => r.storage_path));
  const fresh = input.files.filter((f) => !registered.has(f.storagePath));
  if (fresh.length > 0) {
    const verdict = await inspectContent(fresh);
    if (verdict === "missing") return fail("not_uploaded", "A file did not finish uploading. Try it again.");
    if (verdict === "invalid") return fail("invalid", "One of the files is not a photo or PDF");
    const { error } = await admin.rpc("mark_files_verified", { p_paths: fresh.map((f) => f.storagePath) });
    if (error) return fail("failed", "Could not save the files. Please try again.");
  }

  const p = {
    ...(input.jobId ? { job_id: input.jobId } : input.opportunityId ? { opportunity_id: input.opportunityId } : { customer_id: input.customerId }),
    ...(input.appointmentId ? { appointment_id: input.appointmentId } : {}),
    files: input.files.map((f) => ({ id: f.id, storage_path: f.storagePath, file_name: f.name, mime_type: f.type, size_bytes: f.size, category: f.category })),
  };
  const result = unwrapRpc<RpcResult & { count: number }>(await ctx.supabase.rpc("register_files", { p: p as Json }));
  if (!result.ok) return result;
  return ok({ count: result.data.count });
}

export type FileItem = {
  id: string;
  name: string;
  mimeType: string;
  isImage: boolean;
  category: FileCategory;
  caption: string | null;
  opportunityId: string | null;
  createdAt: string;
  /** Signed for an hour. `thumbUrl` is a resized image when transformation is available, else the same URL. */
  url: string;
  thumbUrl: string;
};

type FileRow = Pick<Database["public"]["Tables"]["files"]["Row"], "id" | "file_name" | "mime_type" | "category" | "caption" | "opportunity_id" | "created_at" | "storage_path">;
const FILE_COLUMNS = "id, file_name, mime_type, category, caption, opportunity_id, created_at, storage_path";

/** Signs rows the caller's own client returned. Rows whose object cannot be signed are dropped. */
async function sign(rows: FileRow[]): Promise<FileItem[]> {
  if (rows.length === 0) return [];
  const storage = createAdminClient().storage.from(BUCKET);
  const { data: signed } = await storage.createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_SECONDS);
  const urlByPath = new Map((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));

  // Image transformation is a paid Supabase feature; without it the grid sizes the full image with CSS.
  const transform = process.env.SUPABASE_IMAGE_TRANSFORM === "true";
  const thumbs = new Map<string, string>();
  if (transform) {
    await Promise.all(
      rows
        .filter((r) => isImage(r.mime_type))
        .map(async (r) => {
          const { data } = await storage.createSignedUrl(r.storage_path, SIGNED_URL_SECONDS, { transform: THUMBNAIL });
          if (data?.signedUrl) thumbs.set(r.id, data.signedUrl);
        }),
    );
  }

  return rows.flatMap((r) => {
    const url = urlByPath.get(r.storage_path);
    if (!url) return [];
    return [
      {
        id: r.id,
        name: r.file_name,
        mimeType: r.mime_type,
        isImage: isImage(r.mime_type),
        category: r.category,
        caption: r.caption,
        opportunityId: r.opportunity_id,
        createdAt: r.created_at,
        url,
        thumbUrl: thumbs.get(r.id) ?? url,
      },
    ];
  });
}

/** Files on a customer (all deals) or on one deal, newest first, as far as RLS lets the caller see. */
export async function listFilesFor(ctx: FileContext, scope: { customerId: string } | { opportunityId: string }): Promise<FileItem[]> {
  let query = ctx.supabase.from("files").select(FILE_COLUMNS).order("created_at", { ascending: false }).range(0, 499);
  query = "opportunityId" in scope ? query.eq("opportunity_id", scope.opportunityId) : query.eq("customer_id", scope.customerId);
  const { data, error } = await query;
  if (error) throw error;
  return sign(data);
}

/** Signed URLs for specific files. Ids the caller cannot read are simply absent from the result. */
export async function signFiles(ctx: FileContext, fileIds: string[]): Promise<FileItem[]> {
  if (fileIds.length === 0) return [];
  const { data, error } = await ctx.supabase.from("files").select(FILE_COLUMNS).in("id", fileIds);
  if (error) throw error;
  return sign(data);
}

/** Staff recategorize or caption a file. Field users have no update policy. */
export async function updateFileDetails(ctx: FileContext, input: { id: string; category: FileCategory; caption?: string }): Promise<ActionResult> {
  if (ctx.profile.role === "field") return NOT_ALLOWED;
  const { data, error } = await ctx.supabase
    .from("files")
    .update({ category: input.category, caption: input.caption?.trim() || null })
    .eq("id", input.id)
    .select("id");
  if (error) return error.code === "42501" ? NOT_ALLOWED : fail("failed", "Could not save the file");
  if (data.length === 0) return fail("not_found", "File not found");
  return ok();
}

/** Admin only: removes the stored object, then the row. */
export async function removeFile(ctx: FileContext, fileId: string): Promise<ActionResult> {
  if (ctx.profile.role !== "admin") return NOT_ALLOWED;
  const { data: row } = await ctx.supabase.from("files").select("id, storage_path").eq("id", fileId).maybeSingle();
  if (!row) return fail("not_found", "File not found");
  const { error: storageError } = await createAdminClient().storage.from(BUCKET).remove([row.storage_path]);
  if (storageError) return fail("storage_failed", "Could not delete the file. Please try again.");
  const { error } = await ctx.supabase.from("files").delete().eq("id", fileId);
  if (error) return error.code === "42501" ? NOT_ALLOWED : fail("failed", "Could not delete the file");
  return ok();
}

