/**
 * Attachment tables (notes, files, activities, appointments) declare `customer_id NOT NULL`, but the
 * `fill_parent_ids` trigger fills it from `job_id` or `opportunity_id` (CLAUDE.md rule 12). The
 * generated Insert types cannot know that, so they demand `customer_id`. `attach()` lets callers
 * pass only the most specific parent id while keeping every other column type-checked.
 */
export type AttachmentInsert<T extends { customer_id: string }> = Omit<T, "customer_id"> & { customer_id?: string };

export function attach<T extends { customer_id: string }>(row: AttachmentInsert<T>): T {
  return row as T;
}
