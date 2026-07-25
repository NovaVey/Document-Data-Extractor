-- Phase 3 item 15: duplicate detection's "replace" path needs to delete
-- the document a new upload is replacing — both its row (extracted_fields/
-- extraction_runs follow via cascade) and its Storage object. Neither a
-- documents DELETE policy nor a storage.objects DELETE policy exists yet;
-- every policy so far has been SELECT/INSERT/UPDATE (Phase 2's own note:
-- write policies land with the feature that needs them, not guessed ahead
-- of time). This is also the delete path Phase 4's "delete removes
-- stored file" criterion verifies.
create policy "org members can delete their org's documents"
  on documents for delete
  using (public.is_org_member(org_id));

-- Same org-scoping as the existing storage.objects insert/select policies:
-- read the org id out of the path's first segment.
create policy "org members can delete their org's documents in storage"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
