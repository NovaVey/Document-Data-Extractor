// Mirrors src/lib/templates/types.ts in the Next.js app (the shape of a
// row's `fields` jsonb column). Small enough, and changed rarely enough,
// that duplicating just this type across the two packages is simpler than
// standing up a shared package for it.
export type FieldType = "text" | "number" | "date" | "currency";

export type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  formatHint?: string;
  validation?: string;
};

export type ExtractedField = {
  key: string;
  rawValue: string;
  modelConfidence: number;
};

export type ExtractionContent =
  | { kind: "text"; text: string }
  | { kind: "image"; mediaType: "image/png" | "image/jpeg" | "image/webp"; base64: string };
