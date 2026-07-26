"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    return { error: storageError.message };
  }

  const { error: deleteError } = await supabase.from("documents").delete().eq("id", documentId);

  if (deleteError) {
    return { error: deleteError.message };
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

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return { error: "No organization membership found" };
  }

  const { data: inserted, error } = await supabase
    .from("documents")
    .insert({
      org_id: membership.org_id,
      template_id: input.templateId,
      original_filename: input.originalFilename,
      storage_path: input.storagePath,
      file_hash: input.fileHash,
      mime_type: input.mimeType,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  // Enqueue: 'uploaded' -> 'queued'. A distinct step (not part of the
  // insert's default) so a future cost-cap check (item 17) has a natural
  // place to block enqueueing without touching the upload path itself.
  // Only the `status` column is grantable here (see migration
  // 20260725040200_enqueue_policy.sql) — this can never touch anything
  // else on the row, even if called with a crafted request.
  const { error: enqueueError } = await supabase
    .from("documents")
    .update({ status: "queued" })
    .eq("id", inserted.id);

  if (enqueueError) {
    return { error: enqueueError.message };
  }

  revalidatePath("/documents");
  return undefined;
}
