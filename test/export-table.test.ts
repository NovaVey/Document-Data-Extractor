import { describe, expect, it } from "vitest";
import {
  buildExportTable,
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
});
