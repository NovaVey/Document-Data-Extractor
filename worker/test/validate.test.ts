import { describe, expect, it } from "vitest";
import { validateFields } from "../src/validation/validate.js";
import type { ExtractedField, TemplateField } from "../src/extraction/types.js";

function field(overrides: Partial<TemplateField> = {}): TemplateField {
  return { key: "total", label: "Total", type: "currency", required: true, ...overrides };
}

function extracted(key: string, rawValue: string, modelConfidence = 1): ExtractedField {
  return { key, rawValue, modelConfidence };
}

function resultFor(results: ReturnType<typeof validateFields>, key: string) {
  const result = results.find((r) => r.key === key);
  if (!result) throw new Error(`no result for ${key}`);
  return result;
}

describe("validateFields — single-field checks", () => {
  it("marks a required, present, parseable field valid", () => {
    const results = validateFields(
      [field({ key: "total", type: "currency", required: true })],
      [extracted("total", "$698.76")],
    );
    const result = resultFor(results, "total");
    expect(result.validationStatus).toBe("valid");
    expect(result.normalizedValue).toBe("698.76");
  });

  it("marks a required, absent field missing", () => {
    const results = validateFields(
      [field({ key: "total", required: true })],
      [extracted("total", "")],
    );
    expect(resultFor(results, "total").validationStatus).toBe("missing");
  });

  it("marks an optional, absent field valid (nothing wrong with it being empty)", () => {
    const results = validateFields(
      [field({ key: "po_number", type: "text", required: false })],
      [extracted("po_number", "")],
    );
    const result = resultFor(results, "po_number");
    expect(result.validationStatus).toBe("valid");
    expect(result.normalizedValue).toBeNull();
  });

  it("marks an unparseable number invalid", () => {
    const results = validateFields(
      [field({ key: "qty", type: "number", required: true })],
      [extracted("qty", "twelve")],
    );
    expect(resultFor(results, "qty").validationStatus).toBe("invalid");
  });

  it("marks an unparseable currency invalid", () => {
    const results = validateFields(
      [field({ key: "total", type: "currency", required: true })],
      [extracted("total", "see attached")],
    );
    expect(resultFor(results, "total").validationStatus).toBe("invalid");
  });

  it("marks an unparseable date invalid", () => {
    const results = validateFields(
      [field({ key: "invoice_date", type: "date", required: true })],
      [extracted("invoice_date", "sometime next week")],
    );
    expect(resultFor(results, "invoice_date").validationStatus).toBe("invalid");
  });

  it("accepts a known due-term for a date field as valid, with no normalized value", () => {
    const results = validateFields(
      [field({ key: "due_date", type: "date", required: false })],
      [extracted("due_date", "Due on receipt")],
    );
    const result = resultFor(results, "due_date");
    expect(result.validationStatus).toBe("valid");
    expect(result.normalizedValue).toBeNull();
    expect(result.validationNotes).toMatch(/non-calendar/i);
  });

  it("treats a text field as valid once non-empty, normalized to the trimmed value", () => {
    const results = validateFields(
      [field({ key: "vendor_name", type: "text", required: true })],
      [extracted("vendor_name", "  Riverbend Supply Co.  ")],
    );
    const result = resultFor(results, "vendor_name");
    expect(result.validationStatus).toBe("valid");
    expect(result.normalizedValue).toBe("Riverbend Supply Co.");
  });
});

describe("validateFields — arithmetic cross-check (subtotal + tax = total)", () => {
  const template: TemplateField[] = [
    field({ key: "subtotal", type: "currency", required: false }),
    field({ key: "tax", type: "currency", required: false }),
    field({ key: "total", type: "currency", required: true }),
  ];

  it("passes when subtotal + tax equals total", () => {
    const results = validateFields(template, [
      extracted("subtotal", "$647.00"),
      extracted("tax", "$51.76"),
      extracted("total", "$698.76"),
    ]);
    expect(resultFor(results, "subtotal").validationStatus).toBe("valid");
    expect(resultFor(results, "tax").validationStatus).toBe("valid");
    expect(resultFor(results, "total").validationStatus).toBe("valid");
  });

  it("flags all three fields when the arithmetic doesn't add up", () => {
    const results = validateFields(template, [
      extracted("subtotal", "$647.00"),
      extracted("tax", "$51.76"),
      extracted("total", "$750.00"), // should be 698.76
    ]);
    expect(resultFor(results, "subtotal").validationStatus).toBe("invalid");
    expect(resultFor(results, "tax").validationStatus).toBe("invalid");
    expect(resultFor(results, "total").validationStatus).toBe("invalid");
    expect(resultFor(results, "total").validationNotes).toMatch(/arithmetic mismatch/i);
  });

  it("tolerates sub-cent rounding differences", () => {
    const results = validateFields(template, [
      extracted("subtotal", "$455.00"),
      extracted("tax", "$37.54"), // 455 * 0.0825 = 37.5375, rounds to 37.54
      extracted("total", "$492.54"),
    ]);
    expect(resultFor(results, "total").validationStatus).toBe("valid");
  });

  it("skips the check entirely when the template doesn't define all three fields", () => {
    const results = validateFields(
      [field({ key: "total", type: "currency", required: true })],
      [extracted("total", "$100.00")],
    );
    expect(resultFor(results, "total").validationStatus).toBe("valid");
  });

  it("skips the check when one of the three already failed to parse", () => {
    const results = validateFields(template, [
      extracted("subtotal", "not a number"),
      extracted("tax", "$51.76"),
      extracted("total", "$698.76"),
    ]);
    // subtotal stays invalid for its own parse failure, but tax/total
    // aren't dragged in by a check that can't run without a real subtotal
    expect(resultFor(results, "subtotal").validationStatus).toBe("invalid");
    expect(resultFor(results, "tax").validationStatus).toBe("valid");
    expect(resultFor(results, "total").validationStatus).toBe("valid");
  });
});

describe("validateFields — date-order sanity (due_date >= invoice_date)", () => {
  const template: TemplateField[] = [
    field({ key: "invoice_date", type: "date", required: true }),
    field({ key: "due_date", type: "date", required: false }),
  ];

  it("passes when due_date is on or after invoice_date", () => {
    const results = validateFields(template, [
      extracted("invoice_date", "2026-06-14"),
      extracted("due_date", "2026-07-14"),
    ]);
    expect(resultFor(results, "due_date").validationStatus).toBe("valid");
  });

  it("flags due_date when it's before invoice_date", () => {
    const results = validateFields(template, [
      extracted("invoice_date", "2026-06-14"),
      extracted("due_date", "2026-05-01"),
    ]);
    const result = resultFor(results, "due_date");
    expect(result.validationStatus).toBe("invalid");
    expect(result.validationNotes).toMatch(/before invoice date/i);
  });

  it("skips the check when due_date is a known non-date term", () => {
    const results = validateFields(template, [
      extracted("invoice_date", "2026-06-14"),
      extracted("due_date", "Due on receipt"),
    ]);
    expect(resultFor(results, "due_date").validationStatus).toBe("valid");
  });

  it("skips the check when the template doesn't define both date fields", () => {
    const results = validateFields(
      [field({ key: "invoice_date", type: "date", required: true })],
      [extracted("invoice_date", "2026-06-14")],
    );
    expect(resultFor(results, "invoice_date").validationStatus).toBe("valid");
  });
});
