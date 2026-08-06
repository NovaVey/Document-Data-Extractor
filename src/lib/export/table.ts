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

// CSV/XLSX formula injection (CWE-1236): a cell value beginning with =, +,
// -, or @ is interpreted by Excel/Sheets/LibreOffice as a formula rather
// than literal text once the cell is opened or edited. Nothing stops a
// document's raw_value/corrected_value from containing one of these —
// original_filename is attacker-controlled at upload time, template names
// and field values are typed by whoever created the template or corrected
// the field — so a value like "=cmd|'/c calc'!A1" would execute in
// whichever spreadsheet app the export is opened in. A leading apostrophe
// is the standard mitigation (OWASP CSV Injection): spreadsheet apps treat
// a leading `'` as "force text," so the cell renders the value verbatim
// instead of evaluating it.
//
// Applied to every *string* cell in both export formats — CSV has no
// per-cell type metadata to fall back on, and XLSX string cells get the
// same treatment defensively even though write-excel-file writes them as
// genuine text cells (some spreadsheet apps still auto-detect a leading
// operator as a formula on open/edit regardless of stored cell type). Real
// numeric/currency cells in the XLSX path are written as actual JS
// numbers, not strings — callers must not run this on those, since it
// would turn a legitimate negative number like "-100.00" into text.
const FORMULA_LEADING_CHARS = new Set(["=", "+", "-", "@"]);

export function neutralizeFormula(value: string): string {
  return value.length > 0 && FORMULA_LEADING_CHARS.has(value[0]) ? `'${value}` : value;
}

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

  // Medium-priority audit finding, the more dangerous silent sibling of
  // the approve-gate one (approve_document() ignoring an orphaned field,
  // supabase/migrations/20260806020000_approve_document_ignores_orphaned_fields.sql):
  // a template field renamed or removed *after* a document was already
  // extracted and approved leaves that document's real extracted_fields
  // row sitting under its original field_key — historical data, this
  // table is never mutated after the fact — with no column to land in at
  // all, since the walk above only ever considers the CURRENT template's
  // fields. Left alone, resolveFieldValue() below would silently return
  // "" for it: real, already-approved data quietly missing from an
  // export with nothing telling the person who ran it anything was
  // dropped. Any field_key actually present on a document being exported
  // that isn't already covered gets its own fallback column instead —
  // labeled with the raw key itself (there's no surviving template field
  // definition to source a nicer label or type from) — so the data always
  // reaches the export rather than vanishing.
  const exportedDocumentIds = new Set(documents.map((d) => d.id));
  for (const field of fields) {
    if (seenKeys.has(field.field_key) || !exportedDocumentIds.has(field.document_id)) continue;
    seenKeys.add(field.field_key);
    fieldColumns.push({ key: field.field_key, label: field.field_key, type: "text" });
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
