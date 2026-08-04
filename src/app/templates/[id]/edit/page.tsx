import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TemplateField } from "@/lib/templates/types";
import { EditForm } from "./edit-form";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: template, error } = await supabase
    .from("extraction_templates")
    .select("id, name, fields")
    .eq("id", id)
    .maybeSingle();

  // A genuine query failure used to fall through to the same notFound() as
  // "this template doesn't exist" — misleading during a real outage
  // (there's no way to tell the two apart from the 404 page). Only a
  // confirmed-absent row (no error, no data) is a real 404.
  if (error) {
    return (
      <main className="flex flex-1 flex-col gap-6 p-8">
        <h1 className="text-xl font-semibold">Edit template</h1>
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Could not load this template: {error.message}
        </p>
      </main>
    );
  }

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
