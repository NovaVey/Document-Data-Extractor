"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateFields, type TemplateField } from "@/lib/templates/types";

// Returns { error } instead of throwing for expected failures (bad input,
// a Postgres constraint) — Next.js redacts thrown Server Action error
// messages in production ("An error occurred in the Server Components
// render..."), so throwing here would hide the actual validation/DB
// message from the reviewer instead of showing it in the form.
export async function createTemplate(
  name: string,
  fields: TemplateField[],
): Promise<{ error: string } | undefined> {
  const fieldsError = validateFields(fields);
  if (fieldsError) return { error: fieldsError };

  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .limit(1)
    .maybeSingle();
  if (!membership) return { error: "No organization membership found" };

  const { error: insertError } = await supabase.from("extraction_templates").insert({
    org_id: membership.org_id,
    name,
    fields,
  });
  if (insertError) return { error: insertError.message };

  revalidatePath("/templates");
  redirect("/templates");
}

export async function updateTemplate(
  id: string,
  name: string,
  fields: TemplateField[],
): Promise<{ error: string } | undefined> {
  const fieldsError = validateFields(fields);
  if (fieldsError) return { error: fieldsError };

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("extraction_templates")
    .update({ name, fields })
    .eq("id", id);
  if (updateError) return { error: updateError.message };

  revalidatePath("/templates");
  redirect("/templates");
}

export async function deleteTemplate(id: string): Promise<{ error: string } | undefined> {
  const supabase = await createClient();
  const { error } = await supabase.from("extraction_templates").delete().eq("id", id);
  if (error) {
    // documents.template_id -> extraction_templates(id) is ON DELETE RESTRICT
    // (Phase 2 decision): a template with documents still pointing at it
    // can't be deleted, by design — surface that plainly instead of a raw
    // Postgres foreign-key error.
    if (error.code === "23503") {
      return { error: "This template is used by existing documents and can't be deleted." };
    }
    return { error: error.message };
  }

  revalidatePath("/templates");
  return undefined;
}
