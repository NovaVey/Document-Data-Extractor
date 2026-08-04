-- Security hardening: closes two RLS/grant gaps found by a codebase audit,
-- both of which let a raw PostgREST call (not the app's own UI) bypass
-- "mandatory human review before anything reaches export" — the project's
-- core compliance guarantee.

-- Bug 1: the documents INSERT policy (20260725020000_upload_storage.sql,
-- re-created in 20260726010000_demo_org_read_only.sql) only checks org
-- membership via its `with check`, with no column-level restriction — unlike
-- the UPDATE policy two migrations later, which explicitly revokes the
-- default blanket grant and re-grants only `status`. Confirmed live via
-- pg_class.relacl that authenticated held unrestricted table-level INSERT on
-- documents. That meant any org member could POST a document via raw
-- PostgREST with status='approved' and forged approved_by/approved_at,
-- skipping extraction and review entirely — the export route trusts
-- status='approved' at face value.
--
-- Fixed the same way the UPDATE policy already does it: revoke the blanket
-- grant, then grant INSERT only on the columns createDocumentRecord()
-- actually sends (src/app/documents/actions.ts). Any other column
-- (status, approved_by, approved_at, processed_at, error_message, id, ...)
-- now fails with "permission denied for column", confirmed live: an insert
-- explicitly setting status was rejected, while the app's real 6-column
-- insert (as an authenticated org member, id omitted so it defaults) still
-- succeeded.
revoke insert on documents from authenticated;
grant insert (org_id, template_id, original_filename, storage_path, file_hash, mime_type)
  on documents to authenticated;

-- Bug 2: extracted_fields' column-level UPDATE grant
-- (20260725050000_correction_and_approval.sql) was never preceded by a
-- revoke of the default blanket UPDATE grant, despite that migration's own
-- comment saying authenticated should "only ever write the correction
-- columns... never raw_value/normalized_value/model_confidence/
-- validation_status/final_confidence". Confirmed live via pg_class.relacl
-- that authenticated still held unrestricted table-level UPDATE. Combined
-- with the existing RLS with_check (which only requires corrected_by =
-- auth.uid(), not that no other column changed), a single crafted request
-- could set final_confidence above the review threshold in the same update
-- as a plausible-looking correction, bypassing approve_document()'s
-- unresolved-field check without a real correction, and corrupting the
-- extraction pipeline's own output columns.
--
-- Note for anyone touching this again: a bare `revoke update on
-- extracted_fields from authenticated` strips ALL update privilege for that
-- role on the table, including previously-granted column-level privileges —
-- confirmed empirically (not just from docs) via pg_attribute.attacl going
-- fully null after the revoke alone, in a rolled-back test transaction. The
-- fix has to revoke then immediately re-grant the same four correction
-- columns, exactly like the documents UPDATE migration already does; a
-- lone revoke here would have silently broken the correction feature.
revoke update on extracted_fields from authenticated;
grant update (was_corrected, corrected_value, corrected_by, corrected_at)
  on extracted_fields to authenticated;
