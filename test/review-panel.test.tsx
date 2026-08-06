import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Medium-priority audit finding: review-panel.tsx owns the entire
// approve-gate decision (the exact place HP2's field-key-vs-template-
// fields divergence lived, supabase/migrations/20260806020000_
// approve_document_ignores_orphaned_fields.sql) and had zero test
// coverage. Mocked at the module boundary (the Server Actions it calls),
// same shape as upload-form.test.tsx, so these exercise the real
// unresolved-count/flagging/save/approve logic rather than a
// reimplementation of it.
const state = vi.hoisted(() => ({
  saveCorrectionMock: vi.fn(),
  approveDocumentMock: vi.fn(),
}));

vi.mock("../src/app/documents/[id]/actions", () => ({
  saveCorrection: (...args: unknown[]) => state.saveCorrectionMock(...args),
  approveDocument: (...args: unknown[]) => state.approveDocumentMock(...args),
}));

import { ReviewPanel, type ExtractedFieldRow } from "../src/app/documents/[id]/review-panel";
import type { TemplateField } from "../src/lib/templates/types";

const TEMPLATE_FIELDS: TemplateField[] = [
  { key: "invoice_number", label: "Invoice Number", type: "text", required: true },
  { key: "total", label: "Total", type: "currency", required: true },
];

function makeField(overrides: Partial<ExtractedFieldRow> = {}): ExtractedFieldRow {
  return {
    field_key: "invoice_number",
    raw_value: "INV-001",
    normalized_value: "INV-001",
    model_confidence: 0.95,
    final_confidence: 0.95,
    validation_status: "valid",
    validation_notes: null,
    was_corrected: false,
    corrected_value: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.saveCorrectionMock.mockReset().mockResolvedValue(undefined);
  state.approveDocumentMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("ReviewPanel — rendering", () => {
  it("labels each field and shows its current value", () => {
    render(
      <ReviewPanel
        documentId="doc-1"
        documentStatus="needs_review"
        templateFields={TEMPLATE_FIELDS}
        extractedFields={[
          makeField({ field_key: "invoice_number", raw_value: "INV-001" }),
          makeField({ field_key: "total", raw_value: "100.00", normalized_value: "100.00" }),
        ]}
        confidenceThreshold={0.9}
      />,
    );

    expect(screen.getByText("Invoice Number")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice Number")).toHaveValue("INV-001");
    expect(screen.getByLabelText("Total")).toHaveValue("100.00");
  });

  it("shows a flagged field with its own low-confidence value, not stuck showing another field's", () => {
    render(
      <ReviewPanel
        documentId="doc-1"
        documentStatus="needs_review"
        templateFields={TEMPLATE_FIELDS}
        extractedFields={[
          makeField({ field_key: "invoice_number", final_confidence: 0.4 }),
          makeField({ field_key: "total", final_confidence: 0.99 }),
        ]}
        confidenceThreshold={0.9}
      />,
    );

    // Exactly one "Needs attention" flag (the low-confidence field), not
    // one per field regardless of its own confidence.
    expect(screen.getAllByText("Needs attention")).toHaveLength(1);
  });
});

describe("ReviewPanel — approve gate", () => {
  it("disables Approve while an unresolved low-confidence field exists", () => {
    render(
      <ReviewPanel
        documentId="doc-1"
        documentStatus="needs_review"
        templateFields={TEMPLATE_FIELDS}
        extractedFields={[
          makeField({ field_key: "invoice_number", final_confidence: 0.4 }),
          makeField({ field_key: "total", final_confidence: 0.99 }),
        ]}
        confidenceThreshold={0.9}
      />,
    );

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(
      screen.getByText("1 field(s) still need review before this document can be approved."),
    ).toBeInTheDocument();
  });

  it("enables Approve once every field is above threshold or already corrected", () => {
    render(
      <ReviewPanel
        documentId="doc-1"
        documentStatus="needs_review"
        templateFields={TEMPLATE_FIELDS}
        extractedFields={[
          makeField({ field_key: "invoice_number", final_confidence: 0.4, was_corrected: true }),
          makeField({ field_key: "total", final_confidence: 0.99 }),
        ]}
        confidenceThreshold={0.9}
      />,
    );

    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("calls approveDocument with the document id and shows its error on failure", async () => {
    const user = userEvent.setup();
    state.approveDocumentMock.mockResolvedValueOnce({ error: "still blocked" });

    render(
      <ReviewPanel
        documentId="doc-42"
        documentStatus="needs_review"
        templateFields={TEMPLATE_FIELDS}
        extractedFields={[
          makeField({ field_key: "invoice_number", final_confidence: 0.99 }),
          makeField({ field_key: "total", final_confidence: 0.99 }),
        ]}
        confidenceThreshold={0.9}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(state.approveDocumentMock).toHaveBeenCalledWith("doc-42");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("still blocked"));
  });

  it("shows the Approved state once documentStatus is approved, with no editable inputs", () => {
    render(
      <ReviewPanel
        documentId="doc-1"
        documentStatus="approved"
        templateFields={TEMPLATE_FIELDS}
        extractedFields={[makeField({ field_key: "invoice_number" })]}
        confidenceThreshold={0.9}
      />,
    );

    expect(screen.getByText("Approved.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invoice Number")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});

describe("ReviewPanel — corrections", () => {
  it("saves an edited value, marking the field Corrected and clearing its flag", async () => {
    const user = userEvent.setup();

    render(
      <ReviewPanel
        documentId="doc-1"
        documentStatus="needs_review"
        templateFields={TEMPLATE_FIELDS}
        extractedFields={[
          makeField({ field_key: "invoice_number", raw_value: "garbled", final_confidence: 0.2 }),
          makeField({ field_key: "total", final_confidence: 0.99 }),
        ]}
        confidenceThreshold={0.9}
      />,
    );

    const input = screen.getByLabelText("Invoice Number");
    await user.clear(input);
    await user.type(input, "INV-002");
    await user.click(screen.getByRole("button", { name: "Save Invoice Number" }));

    expect(state.saveCorrectionMock).toHaveBeenCalledWith("doc-1", "invoice_number", "INV-002");
    await waitFor(() => expect(screen.getByText("Corrected")).toBeInTheDocument());
    // The flag clears and Approve becomes available now that the only
    // unresolved field has been corrected.
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("shows a per-field error and leaves the field uncorrected when the save fails", async () => {
    const user = userEvent.setup();
    state.saveCorrectionMock.mockResolvedValueOnce({ error: "network error" });

    render(
      <ReviewPanel
        documentId="doc-1"
        documentStatus="needs_review"
        templateFields={TEMPLATE_FIELDS}
        extractedFields={[makeField({ field_key: "invoice_number", final_confidence: 0.4 })]}
        confidenceThreshold={0.9}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save Invoice Number" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network error"));
    expect(screen.queryByText("Corrected")).not.toBeInTheDocument();
  });
});

describe("ReviewPanel — not reviewable", () => {
  it("renders plain text instead of inputs once the document has left needs_review", () => {
    render(
      <ReviewPanel
        documentId="doc-1"
        documentStatus="approved"
        templateFields={TEMPLATE_FIELDS}
        extractedFields={[makeField({ field_key: "invoice_number", raw_value: "INV-001" })]}
        confidenceThreshold={0.9}
      />,
    );

    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it('shows "(not found)" for a field with no value at all', () => {
    render(
      <ReviewPanel
        documentId="doc-1"
        documentStatus="approved"
        templateFields={[TEMPLATE_FIELDS[0]]}
        extractedFields={[
          makeField({ field_key: "invoice_number", raw_value: null, normalized_value: null }),
        ]}
        confidenceThreshold={0.9}
      />,
    );

    expect(screen.getByText("(not found)")).toBeInTheDocument();
  });
});
