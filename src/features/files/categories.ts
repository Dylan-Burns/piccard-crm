import type { Database } from "@/types/database";

export type FileCategory = Database["public"]["Enums"]["file_category"];

export const BUCKET = "crm-files";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 50;

/** Display order of the groups (spec §5.4). */
export const CATEGORY_ORDER = ["photo", "measurement_report", "estimate", "contract", "permit", "insurance", "invoice", "other"] as const satisfies readonly FileCategory[];

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  photo: "Photos",
  measurement_report: "Measurement Report",
  estimate: "Estimate",
  contract: "Contract",
  permit: "Permit",
  insurance: "Insurance",
  invoice: "Invoice",
  other: "Other",
};

/** Categories a field user can read and upload (spec §3.1). The rest can carry prices. */
export const FIELD_CATEGORIES = ["photo", "measurement_report", "permit", "other"] as const satisfies readonly FileCategory[];

/** Accepted types and the extension the server gives each stored object. */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export function extensionFor(mimeType: string): string | null {
  return EXTENSIONS[mimeType.toLowerCase()] ?? null;
}

export const isImage = (mimeType: string) => mimeType.startsWith("image/");

export function defaultCategory(mimeType: string): FileCategory {
  return isImage(mimeType) ? "photo" : "other";
}

/** "10 photos uploaded" wording, shared by toasts. */
export function countLabel(count: number, allImages: boolean) {
  return `${count} ${allImages ? "photo" : "file"}${count === 1 ? "" : "s"}`;
}
