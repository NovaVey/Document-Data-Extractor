import { describe, expect, it } from "vitest";
import { validateFields, type TemplateField } from "../src/lib/templates/types.js";

function field(overrides: Partial<TemplateField> = {}): TemplateField {
  return { key: "total", label: "Total", type: "currency", required: true, ...overrides };
}

describe("validateFields", () => {
  it("accepts a well-formed field list", () => {
    expect(validateFields([field(), field({ key: "invoice_date", type: "date" })])).toBeNull();
  });

  it("rejects an empty field list", () => {
    expect(validateFields([])).toMatch(/at least one field/);
  });

  it("rejects a key with uppercase letters or spaces", () => {
    expect(validateFields([field({ key: "Invoice Number" })])).toMatch(/must be lowercase/);
  });

  it("rejects a key starting with a digit", () => {
    expect(validateFields([field({ key: "1total" })])).toMatch(/must be lowercase/);
  });

  it("rejects duplicate keys", () => {
    expect(validateFields([field(), field()])).toMatch(/used more than once/);
  });

  it("rejects a blank label", () => {
    expect(validateFields([field({ label: "  " })])).toMatch(/needs a label/);
  });

  it("rejects an invalid type", () => {
    // @ts-expect-error deliberately invalid for the test
    expect(validateFields([field({ type: "boolean" })])).toMatch(/invalid type/);
  });
});
