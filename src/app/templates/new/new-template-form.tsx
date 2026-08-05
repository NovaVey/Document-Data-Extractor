"use client";

import { TemplateForm } from "../template-form";
import { createTemplate } from "../actions";
import type { TemplateField } from "@/lib/templates/types";

export function NewTemplateForm() {
  async function handleSubmit(name: string, fields: TemplateField[]) {
    return createTemplate(name, fields);
  }

  return <TemplateForm onSubmit={handleSubmit} submitLabel="Create template" />;
}
