import { describe, expect, it } from "vitest";
import {
  buildExportTable,
  neutralizeFormula,
  resolveFieldValue,
  type ExportDocument,
  type ExportField,
  type ExportTemplate,
} from "../src/lib/export/table.js";
import { toCsv } from "../src/lib/export/csv.js";

function field(overrides: Partial<ExportField> = {}): ExportField {
  return {
    document_id: "doc-1",
    field_key: "total",
    raw_value: "$100.00",
    normalized_value: "100.00",
    was_corrected: false,
    corrected_value: null,
    ...overrides,
  };
}

describe("resolveFieldValue", () => {
  it("prefers the correction when one was made", () => {
    expect(resolveFieldValue(field({ was_corrected: true, corrected_value: "150.00" }))).toBe(
      "150.00",
    );
  });

  it("falls back to the normalized value when uncorrected", () => {
    expect(resolveFieldValue(field())).toBe("100.00");
  });

  it("falls back to the raw value when normalized is null (e.g. an invalid or non-calendar field)", () => {
    expect(resolveFieldValue(field({ normalized_value: null, raw_value: "Due on receipt" }))).toBe(
      "Due on receipt",
    );
  });

  it("returns an empty string when the document has no row for this field", () => {
    expect(resolveFieldValue(undefined)).toBe("");
  });

  it("ignores was_corrected if corrected_value is somehow still null", () => {
    expect(
      resolveFieldValue(
        field({ was_corrected: true, corrected_value: null, normalized_value: "100.00" }),
      ),
    ).toBe("100.00");
  });
});

// The review screen (src/app/documents/[id]/review-panel.tsx) seeds its
// primary displayed value — the input's value in edit mode, and the plain
// text shown once a document is approved — from `corrected_value ??
// raw_value`. It never substitutes normalized_value there; normalized_value
// only ever appears as a secondary "Normalized: ..." annotation below the
// field, and only when it differs from raw_value. resolveFieldValue(), by
// contrast, prefers normalized_value over raw_value for an uncorrected
// field. These tests replicate the screen's own formula and compare it
// against resolveFieldValue() for the real ground-truth raw formats
// (worker/ground-truth/ground-truth.json) to establish exactly when the two
// agree and when they don't. This does not assert the mismatch is correct
// behavior — it documents current behavior for review; production code is
// intentionally left unchanged here (see Phase 4 done-criteria review).
describe("review screen value vs. export value (uncorrected fields)", () => {
  // Mirrors review-panel.tsx's `extracted?.corrected_value ?? extracted?.raw_value ?? ""`.
  function screenValue(f: ExportField): string {
    return f.corrected_value ?? f.raw_value ?? "";
  }

  it("agree when the raw date is already ISO (normalization is a no-op)", () => {
    // riverbend-01 due_date, worker/ground-truth/ground-truth.json
    const f = field({
      field_key: "due_date",
      raw_value: "2026-07-14",
      normalized_value: "2026-07-14",
    });
    expect(screenValue(f)).toBe(resolveFieldValue(f));
  });

  it("disagree for a US-slash date: screen shows the raw slash form, export shows ISO", () => {
    // riverbend-03 invoice_date, worker/ground-truth/ground-truth.json:
    // raw "06/28/2026" normalizes (worker/src/validation/parse.ts parseDate) to "2026-06-28".
    const f = field({
      field_key: "invoice_date",
      raw_value: "06/28/2026",
      normalized_value: "2026-06-28",
    });
    expect(screenValue(f)).toBe("06/28/2026");
    expect(resolveFieldValue(f)).toBe("2026-06-28");
    expect(screenValue(f)).not.toBe(resolveFieldValue(f));
  });

  it("disagree for a written-out date: screen shows the prose form, export shows ISO", () => {
    // riverbend-04 invoice_date, worker/ground-truth/ground-truth.json:
    // raw "July 5, 2026" normalizes to "2026-07-05".
    const f = field({
      field_key: "invoice_date",
      raw_value: "July 5, 2026",
      normalized_value: "2026-07-05",
    });
    expect(screenValue(f)).toBe("July 5, 2026");
    expect(resolveFieldValue(f)).toBe("2026-07-05");
    expect(screenValue(f)).not.toBe(resolveFieldValue(f));
  });

  it("disagree for a currency amount with a $ sign: screen keeps the symbol, export strips it", () => {
    // riverbend-01 subtotal, worker/ground-truth/ground-truth.json:
    // raw "$647.00" normalizes (parseCurrency + toFixed(2), worker/src/validation/validate.ts) to "647.00".
    const f = field({ field_key: "subtotal", raw_value: "$647.00", normalized_value: "647.00" });
    expect(screenValue(f)).toBe("$647.00");
    expect(resolveFieldValue(f)).toBe("647.00");
    expect(screenValue(f)).not.toBe(resolveFieldValue(f));
  });

  it("disagree for a currency amount with a thousands comma: screen keeps '$1,320.00', export strips both", () => {
    // cobalt-01 subtotal, worker/ground-truth/ground-truth.json:
    // raw "$1,320.00" normalizes to "1320.00".
    const f = field({ field_key: "subtotal", raw_value: "$1,320.00", normalized_value: "1320.00" });
    expect(screenValue(f)).toBe("$1,320.00");
    expect(resolveFieldValue(f)).toBe("1320.00");
    expect(screenValue(f)).not.toBe(resolveFieldValue(f));
  });

  it("agree on a non-calendar due term (normalized_value is null, both fall back to raw_value)", () => {
    // Marrow & Finch Print Co. due_date, worker/ground-truth/ground-truth.json: "Due on receipt".
    const f = field({
      field_key: "due_date",
      raw_value: "Due on receipt",
      normalized_value: null,
    });
    expect(screenValue(f)).toBe("Due on receipt");
    expect(resolveFieldValue(f)).toBe("Due on receipt");
    expect(screenValue(f)).toBe(resolveFieldValue(f));
  });

  it("agree once a field is corrected: both screen and export show the human's typed value verbatim", () => {
    const f = field({
      field_key: "subtotal",
      raw_value: "$1,320.00",
      normalized_value: "1320.00",
      was_corrected: true,
      corrected_value: "1320.00",
    });
    expect(screenValue(f)).toBe("1320.00");
    expect(resolveFieldValue(f)).toBe("1320.00");
    expect(screenValue(f)).toBe(resolveFieldValue(f));
  });
});

describe("buildExportTable", () => {
  const templateA: ExportTemplate = {
    id: "tmpl-a",
    name: "Invoices",
    fields: [
      { key: "vendor_name", label: "Vendor", type: "text", required: true },
      { key: "total", label: "Total", type: "currency", required: true },
    ],
  };
  const templateB: ExportTemplate = {
    id: "tmpl-b",
    name: "Receipts",
    fields: [
      { key: "total", label: "Total", type: "currency", required: true },
      { key: "store", label: "Store", type: "text", required: false },
    ],
  };
  const templatesById = new Map([
    [templateA.id, templateA],
    [templateB.id, templateB],
  ]);

  function document(overrides: Partial<ExportDocument> = {}): ExportDocument {
    return {
      id: "doc-1",
      original_filename: "invoice.pdf",
      template_id: templateA.id,
      uploaded_at: "2026-07-01T00:00:00.000Z",
      approved_at: "2026-07-02T00:00:00.000Z",
      ...overrides,
    };
  }

  it("builds metadata columns plus the template's field columns, in order", () => {
    const { headers, rows } = buildExportTable([document()], templatesById, [
      field({
        document_id: "doc-1",
        field_key: "vendor_name",
        raw_value: "Acme",
        normalized_value: "Acme",
      }),
      field({
        document_id: "doc-1",
        field_key: "total",
        raw_value: "$100.00",
        normalized_value: "100.00",
      }),
    ]);

    expect(headers).toEqual([
      "Filename",
      "Template",
      "Uploaded At",
      "Approved At",
      "Vendor",
      "Total",
    ]);
    expect(rows).toEqual([
      [
        "invoice.pdf",
        "Invoices",
        "2026-07-01T00:00:00.000Z",
        "2026-07-02T00:00:00.000Z",
        "Acme",
        "100.00",
      ],
    ]);
  });

  it("unions field columns across documents from different templates, deduping shared keys", () => {
    const { headers, fieldColumns } = buildExportTable(
      [
        document({ id: "doc-1", template_id: templateA.id }),
        document({ id: "doc-2", template_id: templateB.id }),
      ],
      templatesById,
      [],
    );

    // "total" is shared by both templates and appears once, in first-seen
    // order; "store" (only on template B) is appended after it.
    expect(headers).toEqual([
      "Filename",
      "Template",
      "Uploaded At",
      "Approved At",
      "Vendor",
      "Total",
      "Store",
    ]);
    expect(fieldColumns.map((c) => c.key)).toEqual(["vendor_name", "total", "store"]);
  });

  it("leaves a blank cell when a document's own template doesn't define a unioned column", () => {
    const { rows } = buildExportTable(
      [
        document({ id: "doc-1", template_id: templateA.id }),
        document({ id: "doc-2", template_id: templateB.id }),
      ],
      templatesById,
      [
        field({
          document_id: "doc-2",
          field_key: "store",
          raw_value: "Main St",
          normalized_value: "Main St",
        }),
      ],
    );

    const doc1Row = rows[0];
    const doc2Row = rows[1];
    // doc-1 uses template A, which has no "store" field — blank, not undefined/crash.
    expect(doc1Row[doc1Row.length - 1]).toBe("");
    expect(doc2Row[doc2Row.length - 1]).toBe("Main St");
  });

  it("handles a document with no template gracefully", () => {
    const { rows } = buildExportTable([document({ template_id: null })], templatesById, []);
    expect(rows[0][1]).toBe(""); // Template column blank, not a crash
  });

  // Medium-priority audit finding, the more dangerous silent sibling of
  // approve_document() ignoring an orphaned field (HP2): a template field
  // renamed/removed after a document was extracted and approved used to
  // leave that document's real extracted_fields row with no column to
  // land in at all, silently dropped from the export.
  it("gives an orphaned field (its key no longer on the current template) its own fallback column instead of dropping it", () => {
    const { headers, rows, fieldColumns } = buildExportTable(
      [document({ id: "doc-1", template_id: templateA.id })],
      templatesById,
      [
        field({ document_id: "doc-1", field_key: "vendor_name", normalized_value: "Acme" }),
        field({ document_id: "doc-1", field_key: "total", normalized_value: "100.00" }),
        // "old_po_number" isn't on templateA (or templateB) at all -- as if
        // it existed on this template at extraction time and was later
        // renamed/removed.
        field({
          document_id: "doc-1",
          field_key: "old_po_number",
          normalized_value: "PO-4471",
        }),
      ],
    );

    expect(headers).toContain("old_po_number");
    expect(fieldColumns.at(-1)).toEqual({
      key: "old_po_number",
      label: "old_po_number",
      type: "text",
    });
    expect(rows[0].at(-1)).toBe("PO-4471");
  });

  it("never adds a fallback column for a field row belonging to a document that isn't in this export", () => {
    const { headers } = buildExportTable(
      [document({ id: "doc-1", template_id: templateA.id })],
      templatesById,
      [
        field({ document_id: "doc-1", field_key: "vendor_name" }),
        field({ document_id: "doc-1", field_key: "total" }),
        // Belongs to a document not passed to buildExportTable at all --
        // must never leak in as a column just because it shares the
        // `fields` array (defensive; the real caller already scopes its
        // query with .in("document_id", documentIds) first).
        field({ document_id: "doc-99-not-in-this-export", field_key: "unrelated_field" }),
      ],
    );

    expect(headers).not.toContain("unrelated_field");
  });
});

describe("toCsv", () => {
  it("joins headers and rows with commas and CRLF", () => {
    expect(toCsv(["A", "B"], [["1", "2"]])).toBe("A,B\r\n1,2\r\n");
  });

  it("quotes and escapes a field containing a comma", () => {
    expect(toCsv(["Name"], [["Acme, Inc."]])).toBe('Name\r\n"Acme, Inc."\r\n');
  });

  it("quotes and doubles internal quotes", () => {
    expect(toCsv(["Name"], [['Say "hi"']])).toBe('Name\r\n"Say ""hi"""\r\n');
  });

  it("quotes a field containing a newline", () => {
    expect(toCsv(["Notes"], [["line1\nline2"]])).toBe('Notes\r\n"line1\nline2"\r\n');
  });

  it("leaves an ordinary field unquoted", () => {
    expect(toCsv(["Total"], [["100.00"]])).toBe("Total\r\n100.00\r\n");
  });

  // CWE-1236: a cell beginning with =, +, -, or @ would be evaluated as a
  // formula by Excel/Sheets/LibreOffice on open — e.g. a corrected vendor
  // name of "=cmd|'/c calc'!A1" would execute in the reviewer's spreadsheet
  // app. toCsv applies the same apostrophe-prefix mitigation the export
  // route uses for XLSX, so both formats are covered by the same tests here.
  it("neutralizes a formula-leading cell with a leading apostrophe", () => {
    expect(toCsv(["Vendor"], [["=cmd|'/c calc'!A1"]])).toBe("Vendor\r\n'=cmd|'/c calc'!A1\r\n");
  });

  it("neutralizes +, -, and @ leading cells the same way", () => {
    expect(toCsv(["A", "B", "C"], [["+1+1", "-2+3", "@SUM(A1)"]])).toBe(
      "A,B,C\r\n'+1+1,'-2+3,'@SUM(A1)\r\n",
    );
  });

  it("neutralizes a formula-leading header, since template field labels are also user-controlled", () => {
    expect(toCsv(["=SUM(A1:A9)"], [["x"]])).toBe("'=SUM(A1:A9)\r\nx\r\n");
  });

  it("still quotes a neutralized cell that also needs comma/quote escaping", () => {
    expect(toCsv(["Vendor"], [['=HYPERLINK("http://evil")']])).toBe(
      'Vendor\r\n"\'=HYPERLINK(""http://evil"")"\r\n',
    );
  });

  it("leaves an ordinary negative number looking string alone unless it's exactly a leading minus", () => {
    // Still gets neutralized — CSV has no cell-type metadata to distinguish
    // "legitimate negative number" from "formula," so a leading '-' is
    // always neutralized in this format. This documents that tradeoff.
    expect(toCsv(["Total"], [["-100.00"]])).toBe("Total\r\n'-100.00\r\n");
  });
});

describe("neutralizeFormula", () => {
  it("prefixes a value starting with =, +, -, or @ with a leading apostrophe", () => {
    expect(neutralizeFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeFormula("+1+1")).toBe("'+1+1");
    expect(neutralizeFormula("-1+1")).toBe("'-1+1");
    expect(neutralizeFormula("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
  });

  it("leaves an ordinary value unchanged", () => {
    expect(neutralizeFormula("Acme Corp")).toBe("Acme Corp");
    expect(neutralizeFormula("100.00")).toBe("100.00");
  });

  it("leaves an empty string unchanged", () => {
    expect(neutralizeFormula("")).toBe("");
  });

  it("only inspects the first character, not = anywhere in the value", () => {
    expect(neutralizeFormula("Total=100")).toBe("Total=100");
  });
});
