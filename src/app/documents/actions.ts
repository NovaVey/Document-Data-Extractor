"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// RLS already scopes this to the caller's own org — no need to filter by
// org_id explicitly, the same pattern documents/page.tsx uses.
export async function documentExistsForHash(fileHash: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id")
    .eq("file_hash", fileHash)
    .maybeSingle();
  return data !== null;
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
// the row is what makes it visible anywhere in the app.
export async function createDocumentRecord(input: CreateDocumentInput) {
  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    throw new Error("No organization membership found");
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
    throw new Error(error.message);
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
    throw new Error(enqueueError.message);
  }

  revalidatePath("/documents");
}
