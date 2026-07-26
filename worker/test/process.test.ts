import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted lets this mutable state be shared between the vi.mock
// factories below (which vitest hoists above these imports) and the test
// bodies further down, without either side needing the real network.
const state = vi.hoisted(() => ({
  templateFields: [] as unknown[],
  templateError: null as { message: string } | null,
  downloadBytes: new Uint8Array([1, 2, 3]) as Uint8Array | null,
  downloadError: null as { message: string } | null,
  insertError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  insertedRows: [] as Record<string, unknown>[],
  documentUpdates: [] as Record<string, unknown>[],
}));

vi.mock("../src/supabase.js", () => ({
  supabase: {
    from(table: string) {
      if (table === "extraction_templates") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: state.templateError ? null : { fields: state.templateFields },
                error: state.templateError,
              }),
            }),
          }),
        };
      }
      if (table === "extracted_fields") {
        return {
          insert: async (rows: Record<string, unknown>[]) => {
            state.insertedRows.push(...rows);
            return { error: state.insertError };
          },
        };
      }
      if (table === "documents") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              state.documentUpdates.push(patch);
              return { error: state.updateError };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from: () => ({
        download: async () => {
          if (state.downloadError) return { data: null, error: state.downloadError };
          return {
            data: { arrayBuffer: async () => state.downloadBytes!.buffer },
            error: null,
          };
        },
      }),
    },
  },
}));

vi.mock("../src/anthropic.js", () => ({ anthropic: {} }));

const extractFieldsMock = vi.fn();
vi.mock("../src/extraction/extract.js", () => ({
  extractFields: (...args: unknown[]) => extractFieldsMock(...args),
}));

import { processDocument } from "../src/process.js";
import type { DocumentRow } from "../src/types.js";

function baseDocument(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: "doc-1",
    org_id: "org-1",
    template_id: "template-1",
    storage_path: "org-1/doc-1.png",
    original_filename: "invoice.png",
    file_hash: "hash",
    mime_type: "image/png",
    page_count: null,
    status: "processing",
    error_message: null,
    uploaded_at: "2026-07-25T00:00:00Z",
    processed_at: null,
    processing_started_at: "2026-07-25T00:00:00Z",
    approved_by: null,
    approved_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.templateFields = [{ key: "total", label: "Total", type: "currency", required: true }];
  state.templateError = null;
  state.downloadBytes = new Uint8Array([1, 2, 3]);
  state.downloadError = null;
  state.insertError = null;
  state.updateError = null;
  state.insertedRows = [];
  state.documentUpdates = [];
  extractFieldsMock.mockReset();
  extractFieldsMock.mockResolvedValue([
    { key: "total", rawValue: "$100.00", modelConfidence: 0.97 },
  ]);
});

describe("processDocument", () => {
  it("runs the full pipeline: loads the template, extracts, validates, scores, and persists", async () => {
    await processDocument(baseDocument());

    expect(extractFieldsMock).toHaveBeenCalledTimes(1);
    expect(state.insertedRows).toHaveLength(1);
    expect(state.insertedRows[0]).toMatchObject({
      document_id: "doc-1",
      field_key: "total",
      raw_value: "$100.00",
      normalized_value: "100.00",
      model_confidence: 0.97,
      validation_status: "valid",
      final_confidence: 0.97,
    });
    expect(state.documentUpdates).toHaveLength(1);
    expect(state.documentUpdates[0]).toMatchObject({ status: "needs_review" });
    expect(state.documentUpdates[0].processed_at).toBeTypeOf("string");
  });

  it("scores a field below the review threshold when the model itself wasn't confident, even though it validates", async () => {
    extractFieldsMock.mockResolvedValue([
      { key: "total", rawValue: "$100.00", modelConfidence: 0.5 },
    ]);
    await processDocument(baseDocument());
    expect(state.insertedRows[0]).toMatchObject({
      validation_status: "valid",
      final_confidence: 0.5,
    });
  });

  it("forces final_confidence to 0 when a field fails validation, no matter the model's confidence", async () => {
    extractFieldsMock.mockResolvedValue([
      { key: "total", rawValue: "not a number", modelConfidence: 0.99 },
    ]);
    await processDocument(baseDocument());
    expect(state.insertedRows[0]).toMatchObject({
      validation_status: "invalid",
      final_confidence: 0,
    });
  });

  it("throws when the document has no template assigned", async () => {
    await expect(processDocument(baseDocument({ template_id: null }))).rejects.toThrow(
      /no template/i,
    );
    expect(state.insertedRows).toHaveLength(0);
  });

  it("throws on an unsupported mime type before calling the model", async () => {
    await expect(processDocument(baseDocument({ mime_type: "application/zip" }))).rejects.toThrow(
      /unsupported mime type/i,
    );
    expect(extractFieldsMock).not.toHaveBeenCalled();
  });

  it("throws when the template fails to load", async () => {
    state.templateError = { message: "not found" };
    await expect(processDocument(baseDocument())).rejects.toThrow(/failed to load template/i);
  });

  it("throws when the storage download fails", async () => {
    state.downloadError = { message: "object not found" };
    await expect(processDocument(baseDocument())).rejects.toThrow(/failed to download/i);
  });

  it("throws when inserting extracted fields fails, without updating the document", async () => {
    state.insertError = { message: "constraint violation" };
    await expect(processDocument(baseDocument())).rejects.toThrow(
      /failed to insert extracted fields/i,
    );
    expect(state.documentUpdates).toHaveLength(0);
  });

  // Phase 3 item 16 (failure isolation): real corrupt/locked PDF bytes,
  // not a mocked throw — extractPdfText() itself isn't mocked in this
  // file, so these exercise the actual unpdf parsing failure propagating
  // all the way out of processDocument(), exactly what tick.ts's catch
  // has to receive to mark the document failed without affecting anyone
  // else in the queue.
  it("propagates the real parsing error for a corrupt PDF", async () => {
    state.downloadBytes = new Uint8Array(await readFile("test/fixtures/corrupt-invoice.pdf"));
    await expect(processDocument(baseDocument({ mime_type: "application/pdf" }))).rejects.toThrow(
      /invalid pdf structure/i,
    );
    expect(extractFieldsMock).not.toHaveBeenCalled();
  });

  it("propagates the real parsing error for a password-locked PDF", async () => {
    state.downloadBytes = new Uint8Array(await readFile("test/fixtures/locked-invoice.pdf"));
    await expect(processDocument(baseDocument({ mime_type: "application/pdf" }))).rejects.toThrow(
      /password/i,
    );
    expect(extractFieldsMock).not.toHaveBeenCalled();
  });
});
