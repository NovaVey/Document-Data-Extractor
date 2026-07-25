"use client";

import { useState } from "react";
import { FIELD_TYPES, type FieldType, type TemplateField } from "@/lib/templates/types";

const EMPTY_FIELD: TemplateField = {
  key: "",
  label: "",
  type: "text",
  required: false,
  formatHint: "",
  validation: "",
};

type TemplateFormProps = {
  initialName?: string;
  initialFields?: TemplateField[];
  onSubmit: (name: string, fields: TemplateField[]) => Promise<void>;
  submitLabel: string;
};

export function TemplateForm({
  initialName = "",
  initialFields,
  onSubmit,
  submitLabel,
}: TemplateFormProps) {
  const [name, setName] = useState(initialName);
  const [fields, setFields] = useState<TemplateField[]>(
    initialFields && initialFields.length > 0 ? initialFields : [{ ...EMPTY_FIELD }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function updateField(index: number, patch: Partial<TemplateField>) {
    setFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function addField() {
    setFields((prev) => [...prev, { ...EMPTY_FIELD }]);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit(
        name,
        fields.map((field) => ({
          ...field,
          formatHint: field.formatHint || undefined,
          validation: field.validation || undefined,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="template-name" className="text-sm font-medium">
          Template name
        </label>
        <input
          id="template-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Standard Invoice"
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Fields</span>
          <button type="button" onClick={addField} className="text-sm underline underline-offset-2">
            + Add field
          </button>
        </div>

        {fields.map((field, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded border border-black/10 p-3 dark:border-white/15"
          >
            <div className="flex gap-2">
              <input
                required
                value={field.key}
                onChange={(event) => updateField(index, { key: event.target.value })}
                placeholder="key (e.g. invoice_number)"
                className="w-1/2 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
              />
              <input
                required
                value={field.label}
                onChange={(event) => updateField(index, { label: event.target.value })}
                placeholder="Label (e.g. Invoice Number)"
                className="w-1/2 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
              />
            </div>
            <div className="flex items-center gap-3">
              <select
                value={field.type}
                onChange={(event) => updateField(index, { type: event.target.value as FieldType })}
                className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(event) => updateField(index, { required: event.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                onClick={() => removeField(index)}
                className="ml-auto text-sm text-red-600 underline underline-offset-2 dark:text-red-400"
              >
                Remove
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={field.formatHint ?? ""}
                onChange={(event) => updateField(index, { formatHint: event.target.value })}
                placeholder="Format hint (optional, e.g. MM/DD/YYYY)"
                className="w-1/2 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
              />
              <input
                value={field.validation ?? ""}
                onChange={(event) => updateField(index, { validation: event.target.value })}
                placeholder="Validation note (optional)"
                className="w-1/2 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
              />
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
