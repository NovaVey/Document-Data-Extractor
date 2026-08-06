-- High-priority finding from the 2026-08-06 fresh audit: a document that
-- ends up `failed` (a transient Storage hiccup, a momentary Claude API
-- error — tick() in worker/src/tick.ts catches processDocument()'s throw
-- into this status) had no retry path at all. The only existing status
-- transition an org member can make is the enqueue policy's narrow
-- uploaded -> queued (supabase/migrations/20260726010000_demo_org_read_only.sql) —
-- nothing covers failed -> queued, so this is a new, equally narrow
-- policy for exactly that one transition, not a broadening of the
-- existing one.
--
-- Deletion needs no new policy: "org members can delete their org's
-- documents" (same migration as above) already has no status
-- restriction — retryDocument()'s sibling, deleteDocument() in
-- src/app/documents/[id]/actions.ts, reuses that existing policy the
-- same way deleteDocumentForReplace() already does.
create policy "org members can retry their org's failed documents"
  on documents for update
  using (status = 'failed' and public.is_writable_org_member(org_id))
  with check (status = 'queued' and public.is_writable_org_member(org_id));
