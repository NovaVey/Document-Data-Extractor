"use server";

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
