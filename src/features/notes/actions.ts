"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentProfileWithRole } from "@/lib/auth";
import { fail, fieldErrors, ok, type ActionResult } from "@/lib/result";
import { attach } from "@/lib/supabase/inserts";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type NoteInsert = Database["public"]["Tables"]["notes"]["Insert"];

const optionalId = z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null);

const addNoteSchema = z
  .object({
    body: z.string().trim().min(1, "Write something first").max(5000),
    customer_id: optionalId,
    opportunity_id: optionalId,
    job_id: optionalId,
    shared_with_crew: z.union([z.literal("on"), z.literal("")]).optional().transform((v) => v === "on"),
  })
  .refine((v) => v.customer_id || v.opportunity_id || v.job_id, { message: "Note needs a record to attach to" });

export async function addNote(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole();
  if (!me) return fail("forbidden", "You do not have permission to do that");
  const parsed = addNoteSchema.safeParse({ shared_with_crew: "", ...Object.fromEntries(formData) });
  if (!parsed.success) return fail("invalid", "Check the note", fieldErrors(parsed.error.issues));
  const { body, customer_id, opportunity_id, job_id, shared_with_crew } = parsed.data;

  // Pass only the most specific parent; the fill_parent_ids trigger supplies the ancestors.
  const parent = job_id ? { job_id } : opportunity_id ? { opportunity_id } : { customer_id: customer_id! };
  const supabase = await createClient();
  const { error } = await supabase.from("notes").insert(attach<NoteInsert>({ body, shared_with_crew, ...parent }));
  if (error) return fail("insert_failed", "Could not save the note");

  const path = formData.get("revalidate");
  if (typeof path === "string" && path.startsWith("/")) revalidatePath(path);
  return ok();
}

export async function deleteNote(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await currentProfileWithRole();
  if (!me) return fail("forbidden", "You do not have permission to do that");
  const id = z.uuid().safeParse(formData.get("note_id"));
  if (!id.success) return fail("invalid", "Invalid note");

  const supabase = await createClient();
  // RLS allows only the author or an admin; a non-matching delete affects no rows.
  const { data, error } = await supabase.from("notes").delete().eq("id", id.data).select("id");
  if (error || !data?.length) return fail("delete_failed", "You can only delete your own notes");

  const path = formData.get("revalidate");
  if (typeof path === "string" && path.startsWith("/")) revalidatePath(path);
  return ok();
}
