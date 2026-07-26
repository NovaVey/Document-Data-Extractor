"use client";

import { TemplateForm } from "../../template-form";
import { updateTemplate } from "../../actions";
import type { TemplateField } from "@/lib/templates/types";

export function EditForm({
  id,
  initialName,
  initialFields,
}: {
  id: string;
  initialName: string;
  initialFields: TemplateField[];
}) {
  async function handleSubmit(name: string, fields: TemplateField[]) {
    return updateTemplate(id, name, fields);
  }

  return (
    <TemplateForm
      initialName={initialName}
      initialFields={initialFields}
      onSubmit={handleSubmit}
      submitLabel="Save changes"
    />
  );
}
