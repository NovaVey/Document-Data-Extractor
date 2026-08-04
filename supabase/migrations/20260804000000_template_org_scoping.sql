-- Medium-priority audit finding: documents.template_id was never checked
-- against the document's own org_id. createDocumentRecord() (src/app/
-- documents/actions.ts) accepts a client-supplied templateId with no
-- org-ownership check, the INSERT RLS policy only checked
-- is_writable_org_member(org_id), and the worker loads the template with
-- the service-role client (bypasses RLS entirely) with zero org check of
-- its own. Net effect: a document could be created against another org's
-- private template, leaking that template's field schema (keys/labels/
-- validation hints) into the attacking org's own extracted_fields once the
-- worker processed it — a cross-tenant isolation break, though it requires
-- knowing another org's opaque template UUID (no enumeration path found).
--
-- Fixed at the one place that actually needs to hold the invariant: the
-- INSERT itself. documents.template_id can never be changed after
-- creation (the enqueue policy in 20260725040200_enqueue_policy.sql grants
-- authenticated UPDATE on the `status` column only), so a template_id/
-- org_id pairing that's valid at insert time stays valid for the row's
-- entire life — the worker (and everything downstream) can trust
-- document.template_id's org membership without re-checking it, once this
-- holds. Consistent with the "enforced at the database layer, not
-- application code that could be bypassed" principle already used for
-- approve_document() and the review-threshold gate.
drop policy if exists "org members can insert documents into their org" on documents;
create policy "org members can insert documents into their org"
  on documents for insert
  with check (
    public.is_writable_org_member(org_id)
    and (
      template_id is null
      or exists (
        select 1 from extraction_templates t
        where t.id = documents.template_id and t.org_id = documents.org_id
      )
    )
  );
