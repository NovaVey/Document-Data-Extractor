-- extracted_fields had no uniqueness constraint on (document_id, field_key),
-- so a reclaimed-and-reprocessed document (worker/src/claim.ts's stale-
-- processing recovery, or a race a heartbeat can reduce but not fully
-- close) would insert a *second* full set of field rows rather than
-- replace the first — leaving two rows per field_key with no defined
-- order, which both the review page's per-field lookup
-- (src/app/documents/[id]/review-panel.tsx) and the export table builder
-- (src/lib/export/table.ts) resolve non-deterministically.
--
-- This index is what makes worker/src/process.ts's switch from insert() to
-- upsert(..., { onConflict: "document_id,field_key" }) actually work —
-- Postgres's ON CONFLICT needs a real unique index/constraint on exactly
-- those columns to detect the conflict against.
create unique index extracted_fields_document_id_field_key_key
  on extracted_fields (document_id, field_key);
