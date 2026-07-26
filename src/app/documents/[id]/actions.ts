"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    return { error: error.message };
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

  const { error } = await supabase.rpc("approve_document", { p_document_id: documentId });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/documents");
  return undefined;
}
