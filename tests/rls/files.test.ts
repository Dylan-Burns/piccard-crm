import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_DENIED, serviceClient, signInAs } from "./helpers";
import { BUCKET } from "@/features/files/categories";
import { createUploadSlots, listFilesFor, registerUploadedFiles, removeFile, signFiles, updateFileDetails, type FileContext, type UploadSlot } from "@/features/files/storage";
import type { Json } from "@/types/database";

const service = serviceClient();
let admin: FileContext, sales: FileContext, field: FileContext, field2: FileContext;
let dealId: string, customerId: string, otherDealId: string, appointmentId: string;
const customers: string[] = [];

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function ctx(email: string, role: "admin" | "sales" | "field"): Promise<FileContext> {
  const { client, userId } = await signInAs(email);
  return { supabase: client, profile: { id: userId, role } };
}

let seq = 0;
async function newDeal() {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "File", last_name: `Test${n}`, phone: `556${n}`, phone_e164: `+1872${n}`, address_line1: `${seq} Photo St`, postal_code: "62701", work_type: "roof_repair", owner_id: sales.profile.id } as Json,
  });
  const r = data as { opportunity_id: string; customer_id: string };
  customers.push(r.customer_id);
  return r;
}

/** Uploads a body to a signed upload URL the way the browser uploader does. */
async function put(slot: UploadSlot, type = "image/png") {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", new Blob([PNG], { type }));
  const response = await fetch(slot.signedUrl, { method: "PUT", body });
  expect(response.ok, await response.clone().text()).toBe(true);
}

const photos = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `roof-${i + 1}.png`, type: "image/png", size: PNG.length }));
const toRegister = (uploads: UploadSlot[], category: "photo" | "estimate" | "measurement_report" = "photo", type = "image/png") =>
  uploads.map((u, i) => ({ id: u.id, storagePath: u.storagePath, name: `roof-${i + 1}.png`, type, size: PNG.length, category }));
const activityCount = async (opportunityId: string) =>
  (await service.from("activities").select("summary").eq("opportunity_id", opportunityId).eq("type", "files_uploaded")).data!;

beforeAll(async () => {
  admin = await ctx("admin@test.local", "admin");
  sales = await ctx("sales@test.local", "sales");
  field = await ctx("field@test.local", "field");
  field2 = await ctx("field2@test.local", "field");

  ({ opportunity_id: dealId, customer_id: customerId } = await newDeal());
  ({ opportunity_id: otherDealId } = await newDeal());
  const { data } = await sales.supabase.rpc("schedule_appointment", {
    p: { opportunity_id: dealId, type: "inspection", starts_at: "2031-04-04T15:00:00Z", ends_at: "2031-04-04T16:00:00Z", assigned_to: field.profile.id } as Json,
  });
  appointmentId = (data as { appointment_id: string }).appointment_id;
});

afterAll(async () => {
  for (const id of customers) {
    const { data: rows } = await service.from("files").select("storage_path").eq("customer_id", id);
    if (rows?.length) await service.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
});

describe("upload URLs", () => {
  it("a field user gets upload URLs for an assigned deal and is refused for an unassigned one", async () => {
    const allowed = await createUploadSlots(field, { opportunityId: dealId, appointmentId, files: photos(2) });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.data.uploads).toHaveLength(2);
    for (const upload of allowed.data.uploads) {
      expect(upload.storagePath).toBe(`${customerId}/${dealId}/${upload.id}.png`);
      expect(upload.signedUrl).toContain("/object/upload/sign/crm-files/");
    }

    expect(await createUploadSlots(field, { opportunityId: otherDealId, files: photos(1) })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await createUploadSlots(field2, { opportunityId: dealId, files: photos(1) })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    // Field uploads always belong to a deal, and the appointment must be on that deal.
    expect(await createUploadSlots(field, { customerId, files: photos(1) })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await createUploadSlots(sales, { opportunityId: otherDealId, appointmentId, files: photos(1) })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("staff can upload to a deal or straight to a customer", async () => {
    const onCustomer = await createUploadSlots(sales, { customerId, files: [{ name: "report.pdf", type: "application/pdf", size: 1000 }] });
    expect(onCustomer.ok && onCustomer.data.uploads[0]!.storagePath.startsWith(`${customerId}/_/`)).toBe(true);
    expect(onCustomer.ok && onCustomer.data.uploads[0]!.storagePath.endsWith(".pdf")).toBe(true);
  });

  it("the bucket is private and has no policies for signed-in users", async () => {
    const { data: bucket } = await service.storage.getBucket(BUCKET);
    expect(bucket).toMatchObject({ public: false, file_size_limit: 25 * 1024 * 1024 });
    const direct = await sales.supabase.storage.from(BUCKET).upload(`${customerId}/${dealId}/direct.png`, PNG, { contentType: "image/png" });
    expect(direct.error).not.toBeNull();
    const { data: listed } = await sales.supabase.storage.from(BUCKET).list(`${customerId}/${dealId}`);
    expect(listed ?? []).toEqual([]);
  });
});

describe("register_files", () => {
  it("five files create five rows and exactly one files_uploaded activity", async () => {
    const slots = await createUploadSlots(field, { opportunityId: dealId, appointmentId, files: photos(5) });
    if (!slots.ok) throw new Error(slots.error.message);
    await Promise.all(slots.data.uploads.map((u) => put(u)));

    const input = { opportunityId: dealId, appointmentId, files: toRegister(slots.data.uploads) };
    expect(await registerUploadedFiles(field, input)).toEqual({ ok: true, data: { count: 5 } });

    const { data: rows } = await service.from("files").select("customer_id, opportunity_id, appointment_id, category, uploaded_by").in("id", slots.data.uploads.map((u) => u.id));
    expect(rows).toHaveLength(5);
    for (const row of rows!) {
      expect(row).toEqual({ customer_id: customerId, opportunity_id: dealId, appointment_id: appointmentId, category: "photo", uploaded_by: field.profile.id });
    }
    expect(await activityCount(dealId)).toEqual([{ summary: "5 photos uploaded" }]);

    // A repeated call (a retried request) adds nothing.
    expect(await registerUploadedFiles(field, input)).toEqual({ ok: true, data: { count: 0 } });
    expect(await activityCount(dealId)).toHaveLength(1);
  });

  it("refuses paths outside the deal, objects that were never uploaded, and callers without access", async () => {
    const slots = await createUploadSlots(sales, { opportunityId: dealId, files: photos(1) });
    if (!slots.ok) throw new Error(slots.error.message);
    const [slot] = slots.data.uploads;

    expect(await registerUploadedFiles(sales, { opportunityId: dealId, files: toRegister([slot!]) })).toMatchObject({ ok: false, error: { code: "not_uploaded" } });
    await put(slot!);
    // The same object claimed for a different deal: the path does not match that deal's prefix.
    expect(await registerUploadedFiles(sales, { opportunityId: otherDealId, files: toRegister([slot!]) })).toMatchObject({ ok: false, error: { code: "invalid" } });
    // Field users cannot file something as an estimate.
    expect(await registerUploadedFiles(field, { opportunityId: dealId, files: toRegister([slot!], "estimate") })).toMatchObject({ ok: false, error: { code: "invalid" } });

    const p = { opportunity_id: dealId, files: [{ id: slot!.id, storage_path: slot!.storagePath, file_name: "x.png", mime_type: "image/png", size_bytes: PNG.length }] } as Json;
    expect((await field2.supabase.rpc("register_files", { p })).error?.code).toBe(PERMISSION_DENIED);
    expect((await field.supabase.rpc("register_files", { p: { ...(p as object), opportunity_id: otherDealId } as Json })).error?.code).toBe(PERMISSION_DENIED);
    const direct = await field.supabase.from("files").insert({ customer_id: customerId, opportunity_id: dealId, storage_path: slot!.storagePath, file_name: "x.png", mime_type: "image/png", size_bytes: 1 });
    expect(direct.error?.code).toBe(PERMISSION_DENIED);

    expect(await registerUploadedFiles(sales, { opportunityId: dealId, files: toRegister([slot!]) })).toEqual({ ok: true, data: { count: 1 } });
  });
});

describe("reading, editing, deleting", () => {
  let estimateId: string, photoId: string;

  beforeAll(async () => {
    const slots = await createUploadSlots(sales, { opportunityId: dealId, files: [...photos(1), { name: "estimate.pdf", type: "application/pdf", size: PNG.length }] });
    if (!slots.ok) throw new Error(slots.error.message);
    const [photo, estimate] = slots.data.uploads;
    await put(photo!);
    await put(estimate!, "application/pdf");
    photoId = photo!.id;
    estimateId = estimate!.id;
    const registered = await registerUploadedFiles(sales, {
      opportunityId: dealId,
      files: [...toRegister([photo!]), { id: estimate!.id, storagePath: estimate!.storagePath, name: "estimate.pdf", type: "application/pdf", size: PNG.length, category: "estimate" as const }],
    });
    expect(registered).toEqual({ ok: true, data: { count: 2 } });
  });

  it("a field user cannot get a signed URL for an estimate file", async () => {
    expect(await signFiles(field, [estimateId])).toEqual([]);
    const own = await signFiles(field, [photoId, estimateId]);
    expect(own.map((f) => f.id)).toEqual([photoId]);
    expect((await fetch(own[0]!.url)).ok).toBe(true);

    expect((await listFilesFor(field, { opportunityId: dealId })).every((f) => f.category !== "estimate")).toBe(true);
    expect(await signFiles(field2, [photoId, estimateId])).toEqual([]);
    expect((await signFiles(sales, [photoId, estimateId])).map((f) => f.id).sort()).toEqual([photoId, estimateId].sort());
  });

  it("staff recategorize; field users cannot; only admins delete", async () => {
    expect(await updateFileDetails(field, { id: photoId, category: "other" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect((await field.supabase.from("files").update({ category: "other" }).eq("id", photoId).select("id")).data ?? []).toEqual([]);
    expect(await updateFileDetails(sales, { id: photoId, category: "measurement_report", caption: " North slope " })).toEqual({ ok: true, data: undefined });
    const { data: row } = await service.from("files").select("category, caption, storage_path").eq("id", photoId).single();
    expect(row).toMatchObject({ category: "measurement_report", caption: "North slope" });

    expect(await removeFile(sales, photoId)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await removeFile(admin, photoId)).toEqual({ ok: true, data: undefined });
    expect((await service.from("files").select("id").eq("id", photoId)).data).toEqual([]);
    expect((await service.storage.from(BUCKET).exists(row!.storage_path)).data).toBe(false);
  });
});
