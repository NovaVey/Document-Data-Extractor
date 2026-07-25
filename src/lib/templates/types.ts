export const FIELD_TYPES = ["text", "number", "date", "currency"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  formatHint?: string;
  validation?: string;
};

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

// Applied server-side on every write — the fields column has no DB-level
// shape constraint (Phase 2 decision: jsonb schema checks in Postgres are
// unwieldy), so this is the one place malformed field definitions get
// caught before they reach extraction, where a bad key or duplicate would
// silently corrupt results three steps downstream.
export function validateFields(fields: TemplateField[]): string | null {
  if (fields.length === 0) {
    return "A template needs at least one field.";
  }

  const seenKeys = new Set<string>();
  for (const field of fields) {
    if (!KEY_PATTERN.test(field.key)) {
      return `Field key "${field.key}" must be lowercase letters, numbers, and underscores, starting with a letter.`;
    }
    if (seenKeys.has(field.key)) {
      return `Field key "${field.key}" is used more than once.`;
    }
    seenKeys.add(field.key);

    if (field.label.trim().length === 0) {
      return `Field "${field.key}" needs a label.`;
    }
    if (!FIELD_TYPES.includes(field.type)) {
      return `Field "${field.key}" has an invalid type.`;
    }
  }

  return null;
}
