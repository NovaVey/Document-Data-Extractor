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

// Unbounded before this: every approved document matching the filters
// (plus every one of its extracted_fields rows) was pulled into memory in
// a single request, with no cap — fine at demo scale, but a real
// deployment's export would eventually build an unbounded in-memory table
// and XLSX buffer in one synchronous request, risking a slow response or
// hitting the host's memory/timeout limits (Railway/Vercel). 2000 rows
// keeps the in-memory table and XLSX buffer comfortably small (even a
// wide template's worth of columns per row) while covering every export
// this app would realistically be asked to produce; a real export that
// large should be narrowed by filter rather than served as one response.
const EXPORT_ROW_LIMIT = 2000;

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

  // { count: "exact" } + .limit() together: PostgREST computes the exact
  // total match count independently of the limit, so this tells us both
  // "how many rows would this export include" and "here they are, capped"
  // in one request — no separate count-only query needed on the common
  // (non-overflowing) path.
  let documentsQuery = supabase
    .from("documents")
    .select("id, original_filename, template_id, uploaded_at, approved_at", { count: "exact" })
    .eq("status", "approved")
    .order("approved_at", { ascending: false })
    .limit(EXPORT_ROW_LIMIT);

  if (template) documentsQuery = documentsQuery.eq("template_id", template);
  if (q) documentsQuery = documentsQuery.ilike("original_filename", `%${q}%`);

  const { data: documents, count: totalCount, error: documentsError } = await documentsQuery;

  if (documentsError) {
    return new Response(documentsError.message, { status: 500 });
  }
  if (!documents || documents.length === 0) {
    return new Response("No approved documents match these filters.", { status: 404 });
  }
  // Checked against the exact total, not documents.length — the .limit()
  // above means documents.length can never exceed EXPORT_ROW_LIMIT on its
  // own, so silently serving a truncated export instead of telling the
  // caller it was truncated would be actively misleading.
  if ((totalCount ?? 0) > EXPORT_ROW_LIMIT) {
    return new Response(
      `This export would include ${totalCount} approved documents, over the ${EXPORT_ROW_LIMIT}-row limit for a single export. Narrow the template or filename filter and try again.`,
      { status: 413 },
    );
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
