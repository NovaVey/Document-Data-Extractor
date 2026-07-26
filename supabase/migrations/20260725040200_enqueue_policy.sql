-- Phase 3 item 4: lets an org member enqueue their own just-uploaded
-- document (status 'uploaded' -> 'queued'), and nothing else.
--
-- Deliberately narrow on two axes, not just one:
--   1. Column-level grant: authenticated can UPDATE only the `status`
--      column, not the whole row. Supabase's default table-level grant
--      (see documents_relacl) already gives authenticated blanket UPDATE
--      on every column; that's revoked first so the column grant actually
--      restricts something instead of layering on top of it.
--   2. RLS using/with check: even for that one column, the only allowed
--      transition is 'uploaded' -> 'queued'. Without this, a user hitting
--      the Supabase REST API directly (not through the app's UI) could
--      set status to 'approved' on their own document and skip human
--      review entirely — the one thing this whole project claims never
--      happens.
revoke update on documents from authenticated;
grant update (status) on documents to authenticated;

create policy "org members can enqueue their own uploaded documents"
  on documents for update
  using (status = 'uploaded' and public.is_org_member(org_id))
  with check (status = 'queued' and public.is_org_member(org_id));
