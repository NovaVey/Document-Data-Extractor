export type DocumentStatus =
  "uploaded" | "queued" | "processing" | "needs_review" | "approved" | "failed";

export type DocumentRow = {
  id: string;
  org_id: string;
  template_id: string | null;
  storage_path: string;
  original_filename: string;
  file_hash: string;
  mime_type: string;
  status: DocumentStatus;
  error_message: string | null;
  uploaded_at: string;
  processed_at: string | null;
  processing_started_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
};
