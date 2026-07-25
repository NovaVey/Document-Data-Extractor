"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateFields, type TemplateField } from "@/lib/templates/types";

export async function createTemplate(name: string, fields: TemplateField[]) {
  const error = validateFields(fields);
  if (error) throw new Error(error);

  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .limit(1)
    .maybeSingle();
  if (!membership) throw new Error("No organization membership found");

  const { error: insertError } = await supabase.from("extraction_templates").insert({
    org_id: membership.org_id,
    name,
    fields,
  });
  if (insertError) throw new Error(insertError.message);

  revalidatePath("/templates");
  redirect("/templates");
}

export async function updateTemplate(id: string, name: string, fields: TemplateField[]) {
  const error = validateFields(fields);
  if (error) throw new Error(error);

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("extraction_templates")
    .update({ name, fields })
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);

  revalidatePath("/templates");
  redirect("/templates");
}

export async function deleteTemplate(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("extraction_templates").delete().eq("id", id);
  if (error) {
    // documents.template_id -> extraction_templates(id) is ON DELETE RESTRICT
    // (Phase 2 decision): a template with documents still pointing at it
    // can't be deleted, by design — surface that plainly instead of a raw
    // Postgres foreign-key error.
    if (error.code === "23503") {
      throw new Error("This template is used by existing documents and can't be deleted.");
    }
    throw new Error(error.message);
  }

  revalidatePath("/templates");
}
