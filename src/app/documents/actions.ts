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

  const { error } = await supabase.from("documents").insert({
    org_id: membership.org_id,
    template_id: input.templateId,
    original_filename: input.originalFilename,
    storage_path: input.storagePath,
    file_hash: input.fileHash,
    mime_type: input.mimeType,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/documents");
}
