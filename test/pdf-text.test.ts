import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "../src/lib/extraction/pdf-text.js";

describe("extractPdfText", () => {
  it("extracts the full embedded text layer from a digital PDF", async () => {
    const bytes = new Uint8Array(await readFile("test/fixtures/digital-invoice.pdf"));
    const result = await extractPdfText(bytes);

    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("Riverbend Supply Co.");
    expect(result.text).toContain("INV-10492");
    expect(result.text).toContain("698.76");
  });

  it("extracts nothing from a scanned/image-only PDF — no embedded text layer to read", async () => {
    const bytes = new Uint8Array(await readFile("test/fixtures/scanned-invoice.pdf"));
    const result = await extractPdfText(bytes);

    expect(result.pageCount).toBe(1);
    expect(result.text.trim()).toBe("");
  });
});
