import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  runInsertError: null as { message: string } | null,
  priorRunCount: 0,
  insertedRows: [] as Record<string, unknown>[],
  documentUpdates: [] as Record<string, unknown>[],
  insertedRuns: [] as Record<string, unknown>[],
  upsertOptions: null as Record<string, unknown> | null,
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
          upsert: async (rows: Record<string, unknown>[], opts: Record<string, unknown>) => {
            state.upsertOptions = opts;
            state.insertedRows.push(...rows);
            return { error: state.insertError };
          },
        };
      }
      if (table === "extraction_runs") {
        return {
          select: () => ({
            eq: async () => ({ count: state.priorRunCount, error: null }),
          }),
          insert: async (row: Record<string, unknown>) => {
            state.insertedRuns.push(row);
            return { error: state.runInsertError };
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
  MODEL: "claude-sonnet-5",
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
  state.runInsertError = null;
  state.priorRunCount = 0;
  state.insertedRows = [];
  state.documentUpdates = [];
  state.insertedRuns = [];
  state.upsertOptions = null;
  extractFieldsMock.mockReset();
  extractFieldsMock.mockResolvedValue({
    fields: [{ key: "total", rawValue: "$100.00", modelConfidence: 0.97 }],
    inputTokens: 1000,
    outputTokens: 200,
  });
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
    // Idempotent reprocessing depends on this being an upsert against the
    // real unique index (supabase/migrations/20260727010000_...), not a
    // plain insert — a reclaimed document must overwrite its own prior
    // attempt's rows rather than duplicate them.
    expect(state.upsertOptions).toMatchObject({ onConflict: "document_id,field_key" });
  });

  it("scores a field below the review threshold when the model itself wasn't confident, even though it validates", async () => {
    extractFieldsMock.mockResolvedValue({
      fields: [{ key: "total", rawValue: "$100.00", modelConfidence: 0.5 }],
      inputTokens: 1000,
      outputTokens: 200,
    });
    await processDocument(baseDocument());
    expect(state.insertedRows[0]).toMatchObject({
      validation_status: "valid",
      final_confidence: 0.5,
    });
  });

  it("forces final_confidence to 0 when a field fails validation, no matter the model's confidence", async () => {
    extractFieldsMock.mockResolvedValue({
      fields: [{ key: "total", rawValue: "not a number", modelConfidence: 0.99 }],
      inputTokens: 1000,
      outputTokens: 200,
    });
    await processDocument(baseDocument());
    expect(state.insertedRows[0]).toMatchObject({
      validation_status: "invalid",
      final_confidence: 0,
    });
  });

  it("logs an extraction_runs row with attempt number, model, tokens, cost, and duration", async () => {
    state.priorRunCount = 2;
    await processDocument(baseDocument());

    expect(state.insertedRuns).toHaveLength(1);
    expect(state.insertedRuns[0]).toMatchObject({
      document_id: "doc-1",
      // Denormalized for claim_next_document()'s indexed cost-cap lookup
      // (supabase/migrations/20260806030000_index_cost_cap_lookup.sql) —
      // must come from the claimed document's own org_id, not be omitted.
      org_id: "org-1",
      attempt: 3,
      model: "claude-sonnet-5",
      input_tokens: 1000,
      output_tokens: 200,
      cost_cents: 1,
    });
    expect(state.insertedRuns[0].duration_ms).toBeTypeOf("number");
  });

  it("throws when logging the extraction run fails, without inserting extracted fields", async () => {
    state.runInsertError = { message: "constraint violation" };
    await expect(processDocument(baseDocument())).rejects.toThrow(/failed to log extraction run/i);
    expect(state.insertedRows).toHaveLength(0);
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

// Reclaim-and-reprocess correctness (Phase 9 audit item): a document stuck
// mid-extraction for longer than claim_next_document()'s stale_after window
// (10 minutes by default) becomes eligible for a second worker to pick up
// and reprocess. This heartbeat exists to keep a *genuinely still-running*
// job's processing_started_at fresh so that doesn't happen to a merely-slow
// call; the extracted_fields upsert (asserted above) is the complementary
// fix for when a reclaim happens anyway.
describe("processDocument — heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function heartbeatUpdates() {
    return state.documentUpdates.filter((u) => "processing_started_at" in u);
  }

  it("refreshes processing_started_at periodically while a long extraction is in flight", async () => {
    let resolveExtract!: (value: unknown) => void;
    extractFieldsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveExtract = resolve;
      }),
    );

    const runPromise = processDocument(baseDocument());

    // Two heartbeat periods elapse while extraction is still "running" —
    // well under the 10-minute stale_after window this exists to protect
    // against.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(heartbeatUpdates().length).toBeGreaterThanOrEqual(2);

    resolveExtract({
      fields: [{ key: "total", rawValue: "$100.00", modelConfidence: 0.97 }],
      inputTokens: 1000,
      outputTokens: 200,
    });
    await runPromise;
  });

  it("stops heartbeating once processing succeeds", async () => {
    await processDocument(baseDocument());
    const countAfterSuccess = heartbeatUpdates().length;

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(heartbeatUpdates().length).toBe(countAfterSuccess);
  });

  it("stops heartbeating once processing fails", async () => {
    await expect(processDocument(baseDocument({ mime_type: "application/zip" }))).rejects.toThrow();
    const countAfterFailure = heartbeatUpdates().length;

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(heartbeatUpdates().length).toBe(countAfterFailure);
  });
});
