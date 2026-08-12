"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/org";
import { friendlyDbError, friendlyStorageError } from "@/lib/errors/friendly";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit/check";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type DuplicateDocument = {
  id: string;
  originalFilename: string;
  status: string;
  uploadedAt: string;
};

// Generous headroom above real usage: a 25-file batch upload (the largest
// exercised so far, see WORKFLOW.md) is 25 createDocumentRecord calls in
// one go, plus a duplicate-check call per file — this allows several such
// batches back to back without a legitimate reviewer ever noticing, while
// still bounding a scripted flood.
const DOCUMENT_WRITE_MAX_HITS = 150;
const DOCUMENT_WRITE_WINDOW = "10 minutes";

// RLS already scopes this to the caller's own org — no need to filter by
// org_id explicitly, the same pattern documents/page.tsx uses. Returns the
// existing document's own details (not just a boolean) so the upload form
// can show the reviewer what they're about to skip or replace, instead of
// silently dropping the file.
export async function findDuplicateDocument(fileHash: string): Promise<DuplicateDocument | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, original_filename, status, uploaded_at")
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    originalFilename: data.original_filename,
    status: data.status,
    uploadedAt: data.uploaded_at,
  };
}

// "Replace" deletes the existing document (row + Storage object) so the
// new upload can take the same file_hash — the (org_id, file_hash) unique
// index otherwise has no other way to let a legitimate re-upload through.
// Storage path is looked up server-side via the caller's own RLS-scoped
// SELECT rather than trusted from the client, same reasoning as never
// trusting a client-supplied org_id: the id is the only thing the client
// needs to hand over, everything else about what gets deleted is derived
// from it under RLS.
// Returns { error } instead of throwing for expected failures — Next.js
// redacts thrown Server Action error messages in production ("An error
// occurred in the Server Components render..."), so throwing here would
// hide the actual message from the upload form instead of showing it.
export async function deleteDocumentForReplace(
  documentId: string,
): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  // Shares the same rate-limit bucket as document creation below — a
  // "Replace" click already counts as both a delete and an upload from the
  // reviewer's perspective, so it should count against the same budget
  // rather than getting its own separate (and easily-stacked) allowance.
  const allowed = await checkRateLimit(
    supabase,
    "document_write",
    DOCUMENT_WRITE_MAX_HITS,
    DOCUMENT_WRITE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  const { data: document } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .maybeSingle();

  if (!document) {
    return { error: "Document not found" };
  }

  const { error: storageError } = await supabase.storage
    .from("documents")
    .remove([document.storage_path]);

  if (storageError) {
    // Not routed through friendlyDbError: that helper maps Postgres/
    // PostgREST error codes, which a Supabase Storage error never
    // carries — see upload-form.tsx's uploadEntry() for the same
    // reasoning (this call site was flagged as the same issue), and for
    // why friendlyStorageError() still intercepts an RLS-blocked write
    // specifically rather than passing every Storage message through raw.
    return { error: friendlyStorageError(storageError.message) };
  }

  const { error: deleteError } = await supabase.from("documents").delete().eq("id", documentId);

  if (deleteError) {
    return {
      error: friendlyDbError(
        deleteError,
        "Couldn't remove the existing document record. Please try again.",
      ),
    };
  }

  revalidatePath("/documents");
  return undefined;
}

type CreateDocumentInput = {
  originalFilename: string;
  storagePath: string;
  fileHash: string;
  mimeType: string;
  templateId: string;
};

// org_id is derived from the caller's own membership, never trusted from
// the client — the file itself may already be uploaded by this point, but
// the row is what makes it visible anywhere in the app. Returns { error }
// instead of throwing for expected failures, same reasoning as
// deleteDocumentForReplace above.
export async function createDocumentRecord(
  input: CreateDocumentInput,
): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const membership = await getCurrentMembership();
  if (!membership) {
    return { error: "No organization membership found" };
  }

  const allowed = await checkRateLimit(
    supabase,
    "document_write",
    DOCUMENT_WRITE_MAX_HITS,
    DOCUMENT_WRITE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  // Fast-fail check ahead of the real enforcement: the database's own
  // INSERT policy (supabase/migrations/20260804000000_template_org_scoping.sql)
  // rejects a template_id that doesn't belong to this org regardless of
  // this check, so a crafted request can't skip it — this just turns that
  // into a clear message instead of a raw RLS-violation error string. The
  // app's own UI can never actually hit this (the template dropdown only
  // ever offers templates already scoped to this org), so this only fires
  // for a request that bypassed the UI.
  const { data: template } = await supabase
    .from("extraction_templates")
    .select("id")
    .eq("id", input.templateId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  if (!template) {
    return { error: "Template not found" };
  }

  const { data: inserted, error } = await supabase
    .from("documents")
    .insert({
      org_id: membership.orgId,
      template_id: input.templateId,
      original_filename: input.originalFilename,
      storage_path: input.storagePath,
      file_hash: input.fileHash,
      mime_type: input.mimeType,
    })
    .select("id")
    .single();

  if (error) {
    return {
      error: friendlyDbError(error, "Couldn't save the uploaded document. Please try again."),
    };
  }

  // Enqueue: 'uploaded' -> 'queued'. A distinct step (not part of the
  // insert's default) so the per-org daily cost cap (enforced in
  // claim_next_document(), worker/src/claim.ts — a queued document just
  // waits if the cap's already hit) has nothing to do with the upload path
  // itself. Only the `status` column is grantable here (see migration
  // 20260725040200_enqueue_policy.sql) — this can never touch anything
  // else on the row, even if called with a crafted request.
  const { error: enqueueError } = await supabase
    .from("documents")
    .update({ status: "queued" })
    .eq("id", inserted.id);

  if (enqueueError) {
    return {
      error: friendlyDbError(
        enqueueError,
        "Document was saved but couldn't be queued for processing. Please try again or contact support.",
      ),
    };
  }

  revalidatePath("/documents");
  return undefined;
}
