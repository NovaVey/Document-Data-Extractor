import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TemplateField } from "@/lib/templates/types";
import { EditForm } from "./edit-form";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: template } = await supabase
    .from("extraction_templates")
    .select("id, name, fields")
    .eq("id", id)
    .maybeSingle();

  if (!template) {
    notFound();
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <h1 className="text-xl font-semibold">Edit template</h1>
      <EditForm
        id={template.id}
        initialName={template.name}
        initialFields={(template.fields as TemplateField[]) ?? []}
      />
    </main>
  );
}
