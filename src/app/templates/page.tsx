import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DeleteTemplateButton } from "./delete-template-button";
import type { TemplateField } from "@/lib/templates/types";

export default async function TemplatesPage() {
  const supabase = await createClient();

  const { data: templates, error } = await supabase
    .from("extraction_templates")
    .select("id, name, fields, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Templates</h1>
        <div className="flex items-center gap-4">
          <Link href="/documents" className="text-sm underline underline-offset-2">
            Documents
          </Link>
          <Link
            href="/templates/new"
            className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background"
          >
            New template
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>}

      {!error && templates?.length === 0 && (
        <p className="text-sm text-black/60 dark:text-white/60">
          No templates yet. Create one to start uploading documents against it.
        </p>
      )}

      {!error && templates && templates.length > 0 && (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => {
            const fields = (template.fields as TemplateField[]) ?? [];
            return (
              <li
                key={template.id}
                className="flex items-center justify-between rounded border border-black/10 px-4 py-3 dark:border-white/15"
              >
                <div>
                  <div className="font-medium">{template.name}</div>
                  <div className="text-xs text-black/60 dark:text-white/60">
                    {fields.length} field{fields.length === 1 ? "" : "s"}:{" "}
                    {fields.map((f) => f.key).join(", ")}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/templates/${template.id}/edit`}
                    className="text-sm underline underline-offset-2"
                  >
                    Edit
                  </Link>
                  <DeleteTemplateButton templateId={template.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
