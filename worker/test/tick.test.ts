import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRow } from "../src/types.js";

const state = vi.hoisted(() => ({
  documentUpdates: [] as Record<string, unknown>[],
}));

const claimNextDocumentMock = vi.fn();
vi.mock("../src/claim.js", () => ({
  claimNextDocument: (...args: unknown[]) => claimNextDocumentMock(...args),
}));

const processDocumentMock = vi.fn();
vi.mock("../src/process.js", () => ({
  processDocument: (...args: unknown[]) => processDocumentMock(...args),
}));

vi.mock("../src/supabase.js", () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_column: string, value: string) => {
          state.documentUpdates.push({ ...patch, id: value });
          return { error: null };
        },
      }),
    }),
  },
}));

import { tick } from "../src/tick.js";

function document(overrides: Partial<DocumentRow> = {}): DocumentRow {
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
  claimNextDocumentMock.mockReset();
  processDocumentMock.mockReset();
  state.documentUpdates = [];
});

// This is the actual proof of "failure isolation": a corrupt or locked
// file (Phase 3 item 16) has to fail on its own without jamming the
// queue for whatever comes after it. tick() is the one place that
// guarantee has to hold.
describe("tick", () => {
  it("does nothing when the queue is empty", async () => {
    claimNextDocumentMock.mockResolvedValue(null);
    await tick();
    expect(processDocumentMock).not.toHaveBeenCalled();
    expect(state.documentUpdates).toHaveLength(0);
  });

  it("processes a claimed document without touching its status when processing succeeds", async () => {
    claimNextDocumentMock.mockResolvedValue(document());
    processDocumentMock.mockResolvedValue(undefined);

    await tick();

    expect(processDocumentMock).toHaveBeenCalledTimes(1);
    // processDocument() owns its own status transitions on success —
    // tick() must not also write to the row in that case.
    expect(state.documentUpdates).toHaveLength(0);
  });

  it("marks a document failed when processing throws, without tick() itself throwing", async () => {
    claimNextDocumentMock.mockResolvedValue(document({ id: "doc-fail" }));
    processDocumentMock.mockRejectedValue(new Error("Invalid PDF structure."));

    await expect(tick()).resolves.toBeUndefined();

    expect(state.documentUpdates).toEqual([
      { status: "failed", error_message: "Invalid PDF structure.", id: "doc-fail" },
    ]);
  });

  it("handles a thrown non-Error value without crashing", async () => {
    claimNextDocumentMock.mockResolvedValue(document({ id: "doc-weird" }));
    processDocumentMock.mockRejectedValue("a plain string rejection");

    await expect(tick()).resolves.toBeUndefined();
    expect(state.documentUpdates).toEqual([
      { status: "failed", error_message: "a plain string rejection", id: "doc-weird" },
    ]);
  });

  it("processes a second document normally in the next tick after the first one failed", async () => {
    claimNextDocumentMock
      .mockResolvedValueOnce(document({ id: "doc-corrupt" }))
      .mockResolvedValueOnce(document({ id: "doc-fine" }));
    processDocumentMock
      .mockRejectedValueOnce(new Error("No password given"))
      .mockResolvedValueOnce(undefined);

    await tick();
    await tick();

    expect(processDocumentMock).toHaveBeenCalledTimes(2);
    // Only the corrupt/locked document ever gets marked failed — the
    // second, healthy document's tick completed with no update at all,
    // proving the first failure had zero effect on it.
    expect(state.documentUpdates).toEqual([
      { status: "failed", error_message: "No password given", id: "doc-corrupt" },
    ]);
  });
});
