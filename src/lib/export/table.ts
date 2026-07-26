import type { FieldType, TemplateField } from "@/lib/templates/types";

export type ExportDocument = {
  id: string;
  original_filename: string;
  template_id: string | null;
  uploaded_at: string;
  approved_at: string | null;
};

export type ExportField = {
  document_id: string;
  field_key: string;
  raw_value: string | null;
  normalized_value: string | null;
  was_corrected: boolean;
  corrected_value: string | null;
};

export type ExportTemplate = { id: string; name: string; fields: TemplateField[] };

export type ExportFieldColumn = { key: string; label: string; type: FieldType };

const METADATA_HEADERS = ["Filename", "Template", "Uploaded At", "Approved At"];
export const EXPORT_METADATA_COLUMN_COUNT = METADATA_HEADERS.length;

// A human correction is authoritative once made — it's what a reviewer
// explicitly looked at and confirmed, so it's trusted verbatim rather than
// re-run through the same deterministic parser that wasn't enough to
// validate the original value. Absent a correction, the normalized value
// (already in the ISO/plain-numeric form item 7 computes) is what belongs
// in a spreadsheet, not the raw verbatim transcription.
export function resolveFieldValue(field: ExportField | undefined): string {
  if (!field) return "";
  if (field.was_corrected && field.corrected_value != null) return field.corrected_value;
  if (field.normalized_value != null) return field.normalized_value;
  return field.raw_value ?? "";
}

// An export can span documents from different templates, so the field
// columns are the union of every included document's template fields —
// first-seen order, keyed by field key so two templates sharing a key
// don't produce duplicate columns. A document whose own template doesn't
// define a given key just gets a blank cell there.
export function buildExportTable(
  documents: ExportDocument[],
  templatesById: Map<string, ExportTemplate>,
  fields: ExportField[],
): { headers: string[]; rows: string[][]; fieldColumns: ExportFieldColumn[] } {
  const fieldsByDocument = new Map<string, Map<string, ExportField>>();
  for (const field of fields) {
    if (!fieldsByDocument.has(field.document_id)) {
      fieldsByDocument.set(field.document_id, new Map());
    }
    fieldsByDocument.get(field.document_id)!.set(field.field_key, field);
  }

  const fieldColumns: ExportFieldColumn[] = [];
  const seenKeys = new Set<string>();
  for (const document of documents) {
    const template = document.template_id ? templatesById.get(document.template_id) : undefined;
    for (const templateField of template?.fields ?? []) {
      if (seenKeys.has(templateField.key)) continue;
      seenKeys.add(templateField.key);
      fieldColumns.push({
        key: templateField.key,
        label: templateField.label,
        type: templateField.type,
      });
    }
  }

  const headers = [...METADATA_HEADERS, ...fieldColumns.map((c) => c.label)];

  const rows = documents.map((document) => {
    const template = document.template_id ? templatesById.get(document.template_id) : undefined;
    const documentFields = fieldsByDocument.get(document.id);
    const metadata = [
      document.original_filename,
      template?.name ?? "",
      document.uploaded_at,
      document.approved_at ?? "",
    ];
    const values = fieldColumns.map((column) => resolveFieldValue(documentFields?.get(column.key)));
    return [...metadata, ...values];
  });

  return { headers, rows, fieldColumns };
}
