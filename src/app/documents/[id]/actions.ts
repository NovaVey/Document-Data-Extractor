"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// corrected_by is never taken from the caller — derived from the
// authenticated session and enforced again by the RLS with-check clause
// (corrected_by = auth.uid()), so a crafted request can't attribute a
// correction to someone else even if this action's own check were bypassed.
export async function saveCorrection(
  documentId: string,
  fieldKey: string,
  correctedValue: string,
): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not signed in");
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
    throw new Error(error.message);
  }

  revalidatePath(`/documents/${documentId}`);
}

// The actual review-threshold gate lives in the approve_document()
// Postgres function (Phase 3 item 11 migration), not here — this action
// is just the RPC call. A raw API request that skipped this action
// entirely would still hit the same enforcement in the database.
export async function approveDocument(documentId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("approve_document", { p_document_id: documentId });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/documents");
}
