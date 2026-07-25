// Manual dev tool for tuning the extraction prompt (Phase 3 item 5) — not
// part of the build, not run by CI or the worker itself. Hits the real
// Claude API against the two synthetic invoice fixtures, printing results
// to read by hand. Run after `npm run build`:
//   node scripts/try-extraction.mjs
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { extractPdfText } from "../dist/extraction/pdf-text.js";
import { extractFields } from "../dist/extraction/extract.js";

const INVOICE_TEMPLATE = [
  { key: "vendor_name", label: "Vendor name", type: "text", required: true },
  { key: "invoice_number", label: "Invoice number", type: "text", required: true },
  {
    key: "invoice_date",
    label: "Invoice date",
    type: "date",
    required: true,
    formatHint: "as printed on the document",
  },
  {
    key: "due_date",
    label: "Due date",
    type: "date",
    required: false,
    formatHint: "as printed on the document",
  },
  { key: "po_number", label: "PO number", type: "text", required: false },
  { key: "subtotal", label: "Subtotal", type: "currency", required: false },
  { key: "tax", label: "Tax amount", type: "currency", required: false },
  { key: "total", label: "Total due", type: "currency", required: true },
  {
    key: "shipping_method",
    label: "Shipping method",
    type: "text",
    required: false,
  },
];

// Ground truth, hand-read from worker/test/fixtures — for eyeballing
// accuracy here, not a substitute for item 6's real ground-truth harness.
const EXPECTED = {
  vendor_name: "Riverbend Supply Co.",
  invoice_number: "INV-10492",
  invoice_date: "2026-06-14",
  due_date: "2026-07-14",
  po_number: "PO-88213",
  subtotal: "647.00",
  tax: "51.76",
  total: "698.76",
};

function printResults(label, results) {
  console.log(`\n=== ${label} ===`);
  for (const result of results) {
    const expected = EXPECTED[result.key];
    const looksOff = expected && !result.rawValue.includes(expected.replace(/^0+/, ""));
    console.log(
      `  ${result.key.padEnd(15)} raw="${result.rawValue}" confidence=${result.modelConfidence}${looksOff ? "  <-- check" : ""}`,
    );
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set");
  const client = new Anthropic({ apiKey });

  const digitalBytes = new Uint8Array(await readFile("test/fixtures/digital-invoice.pdf"));
  const { text } = await extractPdfText(digitalBytes);
  const textResults = await extractFields(client, INVOICE_TEMPLATE, { kind: "text", text });
  printResults("digital PDF (text mode)", textResults);

  const imageBytes = await readFile("test/fixtures/scanned-invoice.png");
  const imageResults = await extractFields(client, INVOICE_TEMPLATE, {
    kind: "image",
    mediaType: "image/png",
    base64: imageBytes.toString("base64"),
  });
  printResults("scanned image (vision mode)", imageResults);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
