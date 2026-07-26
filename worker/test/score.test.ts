import { describe, expect, it } from "vitest";
import { computeFinalConfidence, scoreFields } from "../src/scoring/score.js";
import type { ExtractedField } from "../src/extraction/types.js";
import type { FieldValidationResult } from "../src/validation/types.js";

describe("computeFinalConfidence", () => {
  it("passes the model's confidence through unchanged when the validator agrees (valid)", () => {
    expect(computeFinalConfidence(0.92, "valid")).toBe(0.92);
  });

  it("forces confidence to 0 when the validator says invalid, no matter how confident the model was", () => {
    expect(computeFinalConfidence(0.99, "invalid")).toBe(0);
  });

  it("forces confidence to 0 when the field is missing, no matter how confident the model was", () => {
    expect(computeFinalConfidence(0.87, "missing")).toBe(0);
  });
});

describe("scoreFields", () => {
  function extractedField(overrides: Partial<ExtractedField> = {}): ExtractedField {
    return { key: "total", rawValue: "$698.76", modelConfidence: 0.95, ...overrides };
  }

  function validation(overrides: Partial<FieldValidationResult> = {}): FieldValidationResult {
    return {
      key: "total",
      normalizedValue: "698.76",
      validationStatus: "valid",
      validationNotes: null,
      ...overrides,
    };
  }

  it("merges a valid field's extraction and validation results, keeping the model's confidence", () => {
    const [result] = scoreFields([extractedField()], [validation()]);
    expect(result).toEqual({
      key: "total",
      rawValue: "$698.76",
      normalizedValue: "698.76",
      modelConfidence: 0.95,
      validationStatus: "valid",
      validationNotes: null,
      finalConfidence: 0.95,
    });
  });

  it("proves the validator dominates: a high-confidence model result that fails a deterministic check scores 0", () => {
    // A misread total that still parses as a number but fails the
    // subtotal+tax=total arithmetic check — exactly the case the model's
    // self-reported confidence is poorly calibrated for.
    const extracted = extractedField({ rawValue: "$750.00", modelConfidence: 0.98 });
    const failedValidation = validation({
      normalizedValue: "750.00",
      validationStatus: "invalid",
      validationNotes: "arithmetic mismatch: subtotal + tax != total",
    });

    const [result] = scoreFields([extracted], [failedValidation]);

    expect(result.modelConfidence).toBe(0.98);
    expect(result.validationStatus).toBe("invalid");
    expect(result.finalConfidence).toBe(0);
  });

  it("scores a missing required field to 0 regardless of model confidence", () => {
    const extracted = extractedField({ key: "po_number", rawValue: "", modelConfidence: 0.6 });
    const missingValidation = validation({
      key: "po_number",
      normalizedValue: null,
      validationStatus: "missing",
      validationNotes: null,
    });

    const [result] = scoreFields([extracted], [missingValidation]);
    expect(result.finalConfidence).toBe(0);
  });

  it("scores multiple fields independently", () => {
    const results = scoreFields(
      [
        extractedField({ key: "subtotal", rawValue: "$647.00", modelConfidence: 0.9 }),
        extractedField({ key: "total", rawValue: "$698.76", modelConfidence: 0.4 }),
      ],
      [
        validation({ key: "subtotal", normalizedValue: "647.00" }),
        validation({ key: "total", normalizedValue: "698.76" }),
      ],
    );

    expect(results.find((r) => r.key === "subtotal")?.finalConfidence).toBe(0.9);
    expect(results.find((r) => r.key === "total")?.finalConfidence).toBe(0.4);
  });

  it("throws if a validation result is missing for an extracted field", () => {
    expect(() => scoreFields([extractedField({ key: "vendor_name" })], [validation()])).toThrow(
      /no validation result for field "vendor_name"/,
    );
  });
});
