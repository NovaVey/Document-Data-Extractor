import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Backlog item: upload-form.tsx had zero test coverage despite being the
// most complex client component in the app (client-side hashing,
// duplicate detection both within a batch and against the server,
// Skip/Replace, sequential multi-file upload). Real scope, decided here
// rather than left undefined: validation before any network call, both
// duplicate-detection paths, the Skip/Replace flow, success/error
// rendering for both the storage upload and the createDocumentRecord
// call, multi-file sequencing, and the Remove-from-list affordance.
//
// Mocked at the module boundary, same shape as the app's own real
// dependencies — not upload-form.tsx's internals — so these tests exercise
// the actual component logic (validation, hashing, dedup, sequencing)
// rather than a re-implementation of it.
const state = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  uploadMock: vi.fn(),
  createDocumentRecordMock: vi.fn(),
  deleteDocumentForReplaceMock: vi.fn(),
  findDuplicateDocumentMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.routerPush, refresh: state.routerRefresh }),
}));

vi.mock("../src/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ upload: state.uploadMock }),
    },
  }),
}));

vi.mock("../src/app/documents/actions", () => ({
  createDocumentRecord: (...args: unknown[]) => state.createDocumentRecordMock(...args),
  deleteDocumentForReplace: (...args: unknown[]) => state.deleteDocumentForReplaceMock(...args),
  findDuplicateDocument: (...args: unknown[]) => state.findDuplicateDocumentMock(...args),
}));

import { UploadForm } from "../src/app/documents/upload-form";

const TEMPLATES = [{ id: "tmpl-1", name: "Invoices" }];

function makeFile(name: string, content: string, type = "application/pdf"): File {
  return new File([content], name, { type });
}

beforeEach(() => {
  // jsdom's own crypto implementation doesn't reliably provide
  // subtle.digest — stubbed with real Node crypto instead of a fake, so
  // identical file *content* really does hash identically (what
  // upload-form.tsx's within-batch dedup depends on) and different
  // content really does hash differently, same as production.
  vi.stubGlobal("crypto", {
    randomUUID: () => "test-uuid-0000",
    subtle: {
      digest: async (_algorithm: string, data: ArrayBuffer) => {
        const hash = createHash("sha256").update(Buffer.from(data)).digest();
        return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
      },
    },
  });

  state.routerPush.mockReset();
  state.routerRefresh.mockReset();
  state.uploadMock.mockReset().mockResolvedValue({ error: null });
  state.createDocumentRecordMock.mockReset().mockResolvedValue(undefined);
  state.deleteDocumentForReplaceMock.mockReset().mockResolvedValue(undefined);
  state.findDuplicateDocumentMock.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UploadForm — no templates", () => {
  it("prompts to create a template instead of showing the upload UI", () => {
    render(<UploadForm orgId="org-1" templates={[]} />);
    expect(screen.getByText(/create one/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/choose files/i)).not.toBeInTheDocument();
  });
});

describe("UploadForm — validation (no network call)", () => {
  it("rejects an unsupported file type", async () => {
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    // applyAccept: false — the input's `accept` attribute is only a file
    // *picker* hint (the real, unbypassable check is the app's own
    // ALLOWED_MIME_TYPES guard, same as its own comment says); a drag-drop
    // or a picker set to "All Files" can still hand the browser a file
    // the accept attribute would normally filter out, so this test
    // deliberately bypasses userEvent's default accept-filtering to
    // exercise that real app-level guard rather than userEvent's own.
    await userEvent.upload(
      screen.getByLabelText(/choose files/i),
      makeFile("notes.txt", "plain text", "text/plain"),
      { applyAccept: false },
    );

    await screen.findByText(/unsupported file type: text\/plain/i);
    expect(state.uploadMock).not.toHaveBeenCalled();
    expect(state.createDocumentRecordMock).not.toHaveBeenCalled();
  });

  it("rejects a file over the 20MB limit", async () => {
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.pdf", {
      type: "application/pdf",
    });
    await userEvent.upload(screen.getByLabelText(/choose files/i), big);

    await screen.findByText(/exceeds the 20mb limit/i);
    expect(state.uploadMock).not.toHaveBeenCalled();
  });
});

describe("UploadForm — duplicate detection", () => {
  it("flags the second of two identical files in the same batch, without uploading it", async () => {
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    const fileA = makeFile("a.pdf", "same content");
    const fileB = makeFile("b.pdf", "same content");
    await userEvent.upload(screen.getByLabelText(/choose files/i), [fileA, fileB]);

    await screen.findByText(/duplicate of "a\.pdf" earlier in this batch/i);
    // Only fileA (the first occurrence) is ever a candidate for upload —
    // findDuplicateDocument is only even queried for it, and only it
    // reaches createDocumentRecord.
    await waitFor(() => expect(state.createDocumentRecordMock).toHaveBeenCalledTimes(1));
    expect(state.findDuplicateDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("does not flag two different files with different content", async () => {
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(screen.getByLabelText(/choose files/i), [
      makeFile("a.pdf", "content a"),
      makeFile("b.pdf", "content b"),
    ]);

    await waitFor(() => expect(state.createDocumentRecordMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/earlier in this batch/i)).not.toBeInTheDocument();
  });

  it("shows Skip/Replace when the server reports an existing duplicate", async () => {
    state.findDuplicateDocumentMock.mockResolvedValue({
      id: "doc-existing",
      originalFilename: "old.pdf",
      status: "needs_review",
      uploadedAt: "2026-08-01T00:00:00.000Z",
    });
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(screen.getByLabelText(/choose files/i), makeFile("new.pdf", "content"));

    await screen.findByText(/duplicate of "old\.pdf"/i);
    expect(screen.getByRole("button", { name: /^skip$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /replace existing/i })).toBeInTheDocument();
    expect(state.createDocumentRecordMock).not.toHaveBeenCalled();
  });

  it("Skip marks the file skipped without uploading it", async () => {
    state.findDuplicateDocumentMock.mockResolvedValue({
      id: "doc-existing",
      originalFilename: "old.pdf",
      status: "needs_review",
      uploadedAt: "2026-08-01T00:00:00.000Z",
    });
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(screen.getByLabelText(/choose files/i), makeFile("new.pdf", "content"));
    await userEvent.click(await screen.findByRole("button", { name: /^skip$/i }));

    await screen.findByText(/^skipped$/i);
    expect(state.createDocumentRecordMock).not.toHaveBeenCalled();
  });

  it("Replace deletes the existing document, then uploads the new file, in that order", async () => {
    state.findDuplicateDocumentMock.mockResolvedValue({
      id: "doc-existing",
      originalFilename: "old.pdf",
      status: "needs_review",
      uploadedAt: "2026-08-01T00:00:00.000Z",
    });
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(screen.getByLabelText(/choose files/i), makeFile("new.pdf", "content"));
    await userEvent.click(await screen.findByRole("button", { name: /replace existing/i }));

    await waitFor(() =>
      expect(state.deleteDocumentForReplaceMock).toHaveBeenCalledWith("doc-existing"),
    );
    await screen.findByText(/^success$/i);
    expect(state.createDocumentRecordMock).toHaveBeenCalledTimes(1);
    expect(state.routerRefresh).toHaveBeenCalled();

    // Order matters, not just that both happened: Replace only works
    // because deleting the existing row first frees up the (org_id,
    // file_hash) unique index for the new insert — uploading first would
    // hit that constraint on every real Replace click. mock.invocationCallOrder
    // is a global counter shared across all mocks, so comparing the two
    // directly proves delete really ran before create, not just that both
    // were eventually called.
    const deleteOrder = state.deleteDocumentForReplaceMock.mock.invocationCallOrder[0];
    const createOrder = state.createDocumentRecordMock.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  it("shows an error and does not upload when deleting the existing document fails", async () => {
    state.findDuplicateDocumentMock.mockResolvedValue({
      id: "doc-existing",
      originalFilename: "old.pdf",
      status: "needs_review",
      uploadedAt: "2026-08-01T00:00:00.000Z",
    });
    state.deleteDocumentForReplaceMock.mockResolvedValue({
      error: "Couldn't remove the existing document record. Please try again.",
    });
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(screen.getByLabelText(/choose files/i), makeFile("new.pdf", "content"));
    await userEvent.click(await screen.findByRole("button", { name: /replace existing/i }));

    // handleReplace's catch block (upload-form.tsx) is what's under test
    // here: a failed delete must render as a real error, not leave the row
    // stuck on "Replacing…" with no feedback.
    await screen.findByText(/couldn't remove the existing document record\. please try again\./i);
    expect(state.createDocumentRecordMock).not.toHaveBeenCalled();
    expect(state.uploadMock).not.toHaveBeenCalled();
  });
});

describe("UploadForm — success and error paths", () => {
  it("uploads a single valid file successfully, with the correct storage path and metadata, and refreshes the router", async () => {
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(
      screen.getByLabelText(/choose files/i),
      makeFile("invoice.pdf", "content"),
    );

    await screen.findByText(/^success$/i);
    expect(state.uploadMock).toHaveBeenCalledTimes(1);

    // storage.foldername(name)[1] is exactly what the storage.objects RLS
    // policies key off (supabase/migrations/20260725020000_upload_storage.sql)
    // — asserting the real, complete path (not just that upload() was
    // called with *something*) is what would actually catch a bug that
    // drops/mangles the org-id prefix or the filename sanitization.
    // crypto.randomUUID() is stubbed to a fixed value in beforeEach, so
    // this is an exact match, not a pattern.
    expect(state.uploadMock).toHaveBeenCalledWith(
      "org-1/test-uuid-0000-invoice.pdf",
      expect.anything(),
      expect.objectContaining({ contentType: "application/pdf" }),
    );
    expect(state.createDocumentRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        originalFilename: "invoice.pdf",
        storagePath: "org-1/test-uuid-0000-invoice.pdf",
        templateId: "tmpl-1",
        mimeType: "application/pdf",
      }),
    );
    await waitFor(() => expect(state.routerRefresh).toHaveBeenCalled());
  });

  it("sanitizes an unsafe filename in the storage path", async () => {
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(
      screen.getByLabelText(/choose files/i),
      makeFile("weird file (1)!.pdf", "content"),
    );

    await screen.findByText(/^success$/i);
    expect(state.uploadMock).toHaveBeenCalledWith(
      "org-1/test-uuid-0000-weird_file__1__.pdf",
      expect.anything(),
      expect.anything(),
    );
  });

  it("uploads multiple valid files sequentially, all ending in success", async () => {
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(screen.getByLabelText(/choose files/i), [
      makeFile("a.pdf", "content a"),
      makeFile("b.pdf", "content b"),
      makeFile("c.pdf", "content c"),
    ]);

    await waitFor(() => expect(state.createDocumentRecordMock).toHaveBeenCalledTimes(3));
    expect(await screen.findAllByText(/^success$/i)).toHaveLength(3);
  });

  it("shows the storage error's own real message when the upload itself fails", async () => {
    // Not routed through friendlyDbError (see upload-form.tsx's own
    // comment) — a Storage error's real message is shown as-is, since it
    // never carries a Postgres-style code for that helper to key off, and
    // discarding it in favor of a generic fallback would lose real,
    // actionable detail (session expired, quota hit, etc.).
    state.uploadMock.mockResolvedValue({ error: { message: "network down" } });
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(
      screen.getByLabelText(/choose files/i),
      makeFile("invoice.pdf", "content"),
    );

    await screen.findByText(/^network down$/i);
    expect(state.createDocumentRecordMock).not.toHaveBeenCalled();
  });

  it("shows the server's own error when createDocumentRecord fails", async () => {
    state.createDocumentRecordMock.mockResolvedValue({
      error: "Only an organization owner can manage templates.",
    });
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(
      screen.getByLabelText(/choose files/i),
      makeFile("invoice.pdf", "content"),
    );

    await screen.findByText(/only an organization owner can manage templates\./i);
  });
});

describe("UploadForm — Remove from list", () => {
  it("hides only the removed row, leaving the others alone", async () => {
    render(<UploadForm orgId="org-1" templates={TEMPLATES} />);
    await userEvent.upload(screen.getByLabelText(/choose files/i), [
      makeFile("a.pdf", "content a"),
      makeFile("b.pdf", "content b"),
    ]);
    await waitFor(() => expect(state.createDocumentRecordMock).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole("button", { name: /remove a\.pdf from this list/i }));

    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
  });
});
