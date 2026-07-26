// Mirrors the `documents.status` check constraint
// (supabase/migrations/20260725010000_extraction_data_model.sql). Kept
// here rather than generated from the DB since the app has no type
// codegen step yet — same tradeoff already made for TemplateField.
export const DOCUMENT_STATUSES = [
  "uploaded",
  "queued",
  "processing",
  "needs_review",
  "approved",
  "failed",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export function statusLabel(status: string): string {
  return status.replace("_", " ");
}
