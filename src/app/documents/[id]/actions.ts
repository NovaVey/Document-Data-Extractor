"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveReviewConfidenceThreshold } from "@/lib/review/threshold";
import { friendlyDbError } from "@/lib/errors/friendly";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit/check";

// Generous relative to real review sessions: a reviewer correcting many
// fields across many documents back to back is the expected common case
// here, not the abuse case this is meant to catch — sized well above
// anything a person clicking through a review queue would ever hit.
const CORRECTION_MAX_HITS = 500;
const CORRECTION_WINDOW = "5 minutes";
const APPROVAL_MAX_HITS = 200;
const APPROVAL_WINDOW = "5 minutes";
// Same "document_write" bucket documents/actions.ts's upload/replace
// actions already use — retry and delete are the same conceptual
// category (mutating the documents table), not a new abuse surface that
// needs its own limit.
const DOCUMENT_WRITE_MAX_HITS = 150;
const DOCUMENT_WRITE_WINDOW = "10 minutes";

// corrected_by is never taken from the caller — derived from the
// authenticated session and enforced again by the RLS with-check clause
// (corrected_by = auth.uid()), so a crafted request can't attribute a
// correction to someone else even if this action's own check were bypassed.
//
// Returns { error } instead of throwing for expected failures — Next.js
// redacts thrown Server Action error messages in production ("An error
// occurred in the Server Components render..."), so throwing here would
// hide the real message (including approve_document()'s own review-gate
// messages below) from the reviewer instead of showing it inline.
export async function saveCorrection(
  documentId: string,
  fieldKey: string,
  correctedValue: string,
): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const allowed = await checkRateLimit(
    supabase,
    "field_correction",
    CORRECTION_MAX_HITS,
    CORRECTION_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  const { error } = await supabase
    .from("extracted_fields")
    .update({
      was_corrected: true,
      corrected_value: correctedValue,
      corrected_by: user.id,
      corrected_at: new Date().toISOString(),
    })
    .eq("document_id", documentId)
    .eq("field_key", fieldKey);

  if (error) {
    return { error: friendlyDbError(error, "Couldn't save your correction. Please try again.") };
  }

  revalidatePath(`/documents/${documentId}`);
  return undefined;
}

// The actual review-threshold gate lives in the approve_document()
// Postgres function (Phase 3 item 11 migration), not here — this action
// is just the RPC call. A raw API request that skipped this action
// entirely would still hit the same enforcement in the database.
export async function approveDocument(documentId: string): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const allowed = await checkRateLimit(
    supabase,
    "document_approval",
    APPROVAL_MAX_HITS,
    APPROVAL_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  const { error } = await supabase.rpc("approve_document", {
    p_document_id: documentId,
    p_confidence_threshold: resolveReviewConfidenceThreshold(),
  });

  // Not routed through friendlyDbError: approve_document()'s own
  // exceptions (the review-gate messages) are already hand-authored,
  // user-facing text, not a raw constraint error — passing them through
  // as-is is the intended behavior, same as before this change.
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/documents");
  return undefined;
}

// High-priority finding from the 2026-08-06 fresh audit: a document that
// ends up `failed` (a transient Storage hiccup, a momentary Claude API
// error) had no way back into the queue — the only workaround was
// re-uploading the identical file bytes and hoping the duplicate-hash
// dialog offered Replace. The real enforcement is the new failed ->
// queued RLS policy (supabase/migrations/20260806050000_document_retry_policy.sql);
// this fails closed if the document isn't actually `failed` (RLS's
// using() clause requires it), surfaced via the .select().maybeSingle()
// zero-row check same as elsewhere in this app.
//
// Only ever writes `status` — documents' authenticated UPDATE grant is
// column-scoped to just that (20260725040200_enqueue_policy.sql, the same
// restriction the uploaded -> queued enqueue path lives under), and
// error_message/processing_started_at are worker-owned columns (only
// worker/src/tick.ts and process.ts ever write them, via the service-role
// client). Confirmed live in a rolled-back transaction that a wider
// .update() including those columns fails outright with a grant error,
// not just an RLS one. Leaving the stale error_message behind is harmless
// — it's only ever rendered while status is 'failed' — and
// claim_next_document() unconditionally overwrites processing_started_at
// the moment this document is claimed again.
export async function retryDocument(documentId: string): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const allowed = await checkRateLimit(
    supabase,
    "document_write",
    DOCUMENT_WRITE_MAX_HITS,
    DOCUMENT_WRITE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  const { data: updated, error } = await supabase
    .from("documents")
    .update({ status: "queued" })
    .eq("id", documentId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: friendlyDbError(error, "Couldn't retry this document. Please try again.") };
  }
  if (!updated) {
    return { error: "Couldn't retry this document. It may no longer be in a failed state." };
  }

  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/documents");
  return undefined;
}

// Same underlying delete as deleteDocumentForReplace() (documents/actions.ts)
// — remove the Storage object, then the row — but reachable directly from
// the document's own page instead of only through the upload form's
// duplicate-replace flow, and redirects back to the documents list
// afterward since there's nothing left on this page to show. The status
// check below is deliberately app-level, not a new DB restriction: the
// DELETE RLS policy already allows deleting a document in any status
// (deleteDocumentForReplace already relies on that), so this keeps that
// same broad DB capability but scopes this specific new UI entry point
// to the one case it was actually built for, rather than quietly
// becoming a general-purpose delete button for every document status.
export async function deleteDocument(documentId: string): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const allowed = await checkRateLimit(
    supabase,
    "document_write",
    DOCUMENT_WRITE_MAX_HITS,
    DOCUMENT_WRITE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  const { data: document } = await supabase
    .from("documents")
    .select("status, storage_path")
    .eq("id", documentId)
    .maybeSingle();

  if (!document) {
    return { error: "Document not found" };
  }
  if (document.status !== "failed") {
    return { error: "Only a failed document can be deleted from this page." };
  }

  const { error: storageError } = await supabase.storage
    .from("documents")
    .remove([document.storage_path]);
  if (storageError) {
    // Not routed through friendlyDbError: a Supabase Storage error never
    // carries a Postgres-style code for that helper to key off, same
    // reasoning as deleteDocumentForReplace()'s identical call.
    return { error: storageError.message };
  }

  const { error: deleteError } = await supabase.from("documents").delete().eq("id", documentId);
  if (deleteError) {
    return {
      error: friendlyDbError(deleteError, "Couldn't delete this document. Please try again."),
    };
  }

  revalidatePath("/documents");
  redirect("/documents");
}
