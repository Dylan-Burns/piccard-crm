import { z } from "zod";
import { CATEGORY_ORDER, extensionFor, MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD } from "@/features/files/categories";

const uuid = z.uuid();

export const uploadFileSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.string().refine((t) => extensionFor(t) !== null, "Only photos and PDFs can be uploaded"),
  size: z.number().int().positive().max(MAX_FILE_BYTES, "Files can be up to 25 MB"),
});

/** The record an upload lands on. Exactly one of deal or customer; the appointment is optional context. */
export const uploadTargetSchema = z
  .object({
    opportunityId: uuid.optional(),
    customerId: uuid.optional(),
    appointmentId: uuid.optional(),
  })
  .refine((t) => Boolean(t.opportunityId) !== Boolean(t.customerId), "Choose a deal");

export const createUploadUrlsSchema = uploadTargetSchema.and(
  z.object({ files: z.array(uploadFileSchema).min(1).max(MAX_FILES_PER_UPLOAD) }),
);
export type CreateUploadUrlsInput = z.infer<typeof createUploadUrlsSchema>;

export const registerFilesSchema = uploadTargetSchema.and(
  z.object({
    files: z
      .array(
        z.object({
          id: uuid,
          storagePath: z.string().min(1).max(300),
          name: z.string().trim().min(1).max(255),
          type: z.string().refine((t) => extensionFor(t) !== null),
          size: z.number().int().positive().max(MAX_FILE_BYTES),
          category: z.enum(CATEGORY_ORDER),
        }),
      )
      .min(1)
      .max(MAX_FILES_PER_UPLOAD),
  }),
);
export type RegisterFilesInput = z.infer<typeof registerFilesSchema>;

export const updateFileSchema = z.object({
  id: uuid,
  category: z.enum(CATEGORY_ORDER),
  caption: z.string().trim().max(200).optional(),
});
