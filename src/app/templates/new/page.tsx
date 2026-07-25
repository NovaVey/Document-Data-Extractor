"use client";

import { TemplateForm } from "../template-form";
import { createTemplate } from "../actions";
import type { TemplateField } from "@/lib/templates/types";

export default function NewTemplatePage() {
  async function handleSubmit(name: string, fields: TemplateField[]) {
    await createTemplate(name, fields);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <h1 className="text-xl font-semibold">New template</h1>
      <TemplateForm onSubmit={handleSubmit} submitLabel="Create template" />
    </main>
  );
}
