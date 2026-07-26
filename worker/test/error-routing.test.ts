// Phase 4 done-criterion: "Every ground-truth error routed to review."
//
// worker/ground-truth/ is 100% correct by construction (hand-keyed), so it
// can't itself demonstrate what happens when extraction gets something
// wrong. This file plugs that gap: realistic, ground-truth-shaped error
// scenarios run through the real validateFields -> scoreFields ->
// needsAttention chain (no mocks — these are all pure functions), asserting
// the affected field always ends up flagged for review.
import { describe, expect, it } from "vitest";
import { validateFields } from "../src/validation/validate.js";
import { scoreFields } from "../src/scoring/score.js";
import { needsAttention } from "../src/scoring/threshold.js";
import type { ExtractedField, TemplateField } from "../src/extraction/types.js";

function field(overrides: Partial<TemplateField> = {}): TemplateField {
  return { key: "total", label: "Total", type: "currency", required: true, ...overrides };
}

function extracted(key: string, rawValue: string, modelConfidence = 0.97): ExtractedField {
  return { key, rawValue, modelConfidence };
}

// Runs the full pipeline exactly as the worker does: validate the raw
// extraction, score it against those validations, then apply the review
// threshold. Returns the routing outcome for a single field by key.
function routeField(
  templateFields: TemplateField[],
  extractedFields: ExtractedField[],
  key: string,
) {
  const validations = validateFields(templateFields, extractedFields);
  const scored = scoreFields(extractedFields, validations);
  const result = scored.find((r) => r.key === key);
  if (!result) throw new Error(`no scored result for ${key}`);
  return { ...result, flaggedForReview: needsAttention(result.finalConfidence) };
}

describe("ground-truth error routing — end to end (validate -> score -> threshold)", () => {
  it("1. flags a misread total that still parses but breaks subtotal + tax = total (confident but wrong)", () => {
    const template: TemplateField[] = [
      field({ key: "subtotal", type: "currency", required: false }),
      field({ key: "tax", type: "currency", required: false }),
      field({ key: "total", type: "currency", required: true }),
    ];
    const extractedFields = [
      extracted("subtotal", "$647.00", 0.98),
      extracted("tax", "$51.76", 0.97),
      // Model misread this as 750.00 instead of the correct 698.76 — a
      // perfectly well-formed number, and the model was highly confident.
      extracted("total", "$750.00", 0.99),
    ];

    const route = routeField(template, extractedFields, "total");

    expect(route.validationStatus).toBe("invalid");
    expect(route.modelConfidence).toBe(0.99); // the model's own (wrong) confidence
    expect(route.finalConfidence).toBe(0); // hard override wins regardless
    expect(route.flaggedForReview).toBe(true);
  });

  it("2. flags a required field the model reported as empty (missing)", () => {
    const template: TemplateField[] = [
      field({ key: "invoice_number", type: "text", required: true }),
    ];
    const extractedFields = [extracted("invoice_number", "", 0.5)];

    const route = routeField(template, extractedFields, "invoice_number");

    expect(route.validationStatus).toBe("missing");
    expect(route.finalConfidence).toBe(0);
    expect(route.flaggedForReview).toBe(true);
  });

  it("3. flags a garbled, unparseable date in a date-typed field", () => {
    const template: TemplateField[] = [
      field({ key: "invoice_date", type: "date", required: true }),
    ];
    // OCR/model garbage that isn't a real calendar date and isn't a known
    // non-date term like "Due on receipt" either.
    const extractedFields = [extracted("invoice_date", "13/45/2026", 0.9)];

    const route = routeField(template, extractedFields, "invoice_date");

    expect(route.validationStatus).toBe("invalid");
    expect(route.finalConfidence).toBe(0);
    expect(route.flaggedForReview).toBe(true);
  });

  it("4. flags a due_date that falls chronologically before the invoice_date", () => {
    const template: TemplateField[] = [
      field({ key: "invoice_date", type: "date", required: true }),
      field({ key: "due_date", type: "date", required: false }),
    ];
    const extractedFields = [
      extracted("invoice_date", "2026-06-14", 0.98),
      // Transposed digits or a misread year — due_date lands before the
      // invoice was even issued.
      extracted("due_date", "2026-05-01", 0.96),
    ];

    const route = routeField(template, extractedFields, "due_date");

    expect(route.validationStatus).toBe("invalid");
    expect(route.validationNotes).toMatch(/before invoice date/i);
    expect(route.finalConfidence).toBe(0);
    expect(route.flaggedForReview).toBe(true);
  });

  it("5. flags a field the model itself was unsure about, even though it parses fine and validates clean", () => {
    // No validator catches this one — the value is well-formed and every
    // deterministic check passes. Only the model's own low self-reported
    // confidence (0.4) should be enough, on its own, to route it to review.
    const template: TemplateField[] = [field({ key: "vendor_name", type: "text", required: true })];
    const extractedFields = [extracted("vendor_name", "Riverbend Supply Co.", 0.4)];

    const route = routeField(template, extractedFields, "vendor_name");

    expect(route.validationStatus).toBe("valid");
    expect(route.finalConfidence).toBe(0.4); // validator agrees, so model confidence passes through unchanged
    expect(route.flaggedForReview).toBe(true);
  });

  it("6. does NOT flag a genuinely clean, high-confidence, validator-passing field (control case)", () => {
    // Sanity control: proves flagging in the cases above comes from the
    // simulated error, not from some blanket "always flag" behavior.
    const template: TemplateField[] = [
      field({ key: "subtotal", type: "currency", required: false }),
      field({ key: "tax", type: "currency", required: false }),
      field({ key: "total", type: "currency", required: true }),
    ];
    const extractedFields = [
      extracted("subtotal", "$647.00", 0.98),
      extracted("tax", "$51.76", 0.97),
      extracted("total", "$698.76", 0.99),
    ];

    const route = routeField(template, extractedFields, "total");

    expect(route.validationStatus).toBe("valid");
    expect(route.finalConfidence).toBe(0.99);
    expect(route.flaggedForReview).toBe(false);
  });

  it("7. flags every affected field in a single multi-error document, independently", () => {
    // A realistic messy document: several unrelated mistakes at once,
    // mixed in with fields that are actually fine. Every bad field should
    // route to review; the good ones shouldn't.
    const template: TemplateField[] = [
      field({ key: "invoice_number", type: "text", required: true }),
      field({ key: "invoice_date", type: "date", required: true }),
      field({ key: "due_date", type: "date", required: false }),
      field({ key: "subtotal", type: "currency", required: false }),
      field({ key: "tax", type: "currency", required: false }),
      field({ key: "total", type: "currency", required: true }),
      field({ key: "vendor_name", type: "text", required: true }),
    ];
    const extractedFields = [
      extracted("invoice_number", "", 0.6), // missing
      extracted("invoice_date", "2026-06-14", 0.95), // fine
      extracted("due_date", "2026-05-01", 0.95), // before invoice_date
      extracted("subtotal", "$647.00", 0.98), // fine
      extracted("tax", "$51.76", 0.97), // fine
      extracted("total", "$750.00", 0.99), // arithmetic mismatch
      extracted("vendor_name", "Riverbend Supply Co.", 0.4), // low model confidence
    ];

    const validations = validateFields(template, extractedFields);
    const scored = scoreFields(extractedFields, validations);
    const flagged = new Set(
      scored.filter((r) => needsAttention(r.finalConfidence)).map((r) => r.key),
    );

    expect(flagged).toEqual(
      new Set(["invoice_number", "due_date", "subtotal", "tax", "total", "vendor_name"]),
    );
    expect(flagged.has("invoice_date")).toBe(false);
  });
});
