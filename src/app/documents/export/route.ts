import writeXlsxFile from "write-excel-file/node";
import { createClient } from "@/lib/supabase/server";
import type { TemplateField } from "@/lib/templates/types";
import {
  buildExportTable,
  EXPORT_METADATA_COLUMN_COUNT,
  neutralizeFormula,
  type ExportField,
  type ExportTemplate,
} from "@/lib/export/table";
import { toCsv } from "@/lib/export/csv";

// Export only ever reads approved documents, regardless of any status
// filter the caller might pass — this is where "mandatory human review
// before anything reaches export" is actually enforced for the export
// path itself, on top of (not instead of) the approve_document() gate
// that already stops an unreviewed document from reaching 'approved' at
// all (Phase 3 item 11).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const template = searchParams.get("template");
  const q = searchParams.get("q");

  const supabase = await createClient();

  let documentsQuery = supabase
    .from("documents")
    .select("id, original_filename, template_id, uploaded_at, approved_at")
    .eq("status", "approved")
    .order("approved_at", { ascending: false });

  if (template) documentsQuery = documentsQuery.eq("template_id", template);
  if (q) documentsQuery = documentsQuery.ilike("original_filename", `%${q}%`);

  const { data: documents, error: documentsError } = await documentsQuery;

  if (documentsError) {
    return new Response(documentsError.message, { status: 500 });
  }
  if (!documents || documents.length === 0) {
    return new Response("No approved documents match these filters.", { status: 404 });
  }

  const documentIds = documents.map((d) => d.id);

  const [{ data: templateRows }, { data: fieldRows, error: fieldsError }] = await Promise.all([
    supabase.from("extraction_templates").select("id, name, fields"),
    supabase
      .from("extracted_fields")
      .select("document_id, field_key, raw_value, normalized_value, was_corrected, corrected_value")
      .in("document_id", documentIds),
  ]);

  if (fieldsError) {
    return new Response(fieldsError.message, { status: 500 });
  }

  const templatesById = new Map<string, ExportTemplate>(
    (templateRows ?? []).map((t) => [
      t.id,
      { id: t.id, name: t.name, fields: (t.fields as TemplateField[]) ?? [] },
    ]),
  );

  const { headers, rows, fieldColumns } = buildExportTable(
    documents,
    templatesById,
    (fieldRows ?? []) as ExportField[],
  );

  if (format === "csv") {
    return new Response(toCsv(headers, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="documents-export.csv"',
      },
    });
  }

  // Number/currency columns get written as real numeric cells (not text)
  // so the export is actually usable as a spreadsheet — summable,
  // formattable — rather than just a table that happens to render in one.
  // Every other cell stays a string and goes through neutralizeFormula
  // first (CWE-1236) — a real numeric cell is a JS number, never a string
  // starting with =/+/-/@, so it's unaffected either way.
  const sheetData = [
    headers.map(neutralizeFormula),
    ...rows.map((row) =>
      row.map((value, index) => {
        if (index >= EXPORT_METADATA_COLUMN_COUNT) {
          const column = fieldColumns[index - EXPORT_METADATA_COLUMN_COUNT];
          if (column && (column.type === "number" || column.type === "currency") && value !== "") {
            const numeric = Number(value);
            if (Number.isFinite(numeric)) return numeric;
          }
        }
        return neutralizeFormula(value);
      }),
    ),
  ];

  const buffer = await writeXlsxFile(sheetData).toBuffer();

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="documents-export.xlsx"',
    },
  });
}
