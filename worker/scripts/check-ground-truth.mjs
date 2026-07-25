// Manual dev tool: runs real extraction against every ground-truth document
// and reports a quick match/mismatch readout. Not the formal accuracy
// measurement (that's item 9, against real validators + confidence
// scoring) — this is an integrity check that the fixture set and the
// extraction pipeline actually work together end to end, plus an early
// read on where the prompt might need work. Run after `npm run build`:
//   node scripts/check-ground-truth.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { extractPdfText } from "../dist/extraction/pdf-text.js";
import { extractFields } from "../dist/extraction/extract.js";

const TEMPLATE = [
  { key: "vendor_name", label: "Vendor name", type: "text", required: true },
  { key: "invoice_number", label: "Invoice number", type: "text", required: true },
  {
    key: "invoice_date",
    label: "Invoice date",
    type: "date",
    required: true,
    formatHint: "as printed",
  },
  { key: "due_date", label: "Due date", type: "date", required: false, formatHint: "as printed" },
  { key: "po_number", label: "PO number", type: "text", required: false },
  { key: "subtotal", label: "Subtotal", type: "currency", required: false },
  { key: "tax", label: "Tax amount", type: "currency", required: false },
  { key: "total", label: "Total due", type: "currency", required: true },
];

function normalize(value) {
  return (value ?? "")
    .toString()
    .toLowerCase()
    .replace(/[\s,$]/g, "");
}

function matches(actual, expected) {
  if (expected === null) return actual.trim() === "";
  if (actual.trim() === "") return false; // empty string is a substring of everything below — guard it explicitly
  return (
    normalize(actual).includes(normalize(expected)) ||
    normalize(expected).includes(normalize(actual))
  );
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set");
  const client = new Anthropic({ apiKey });

  const groundTruth = JSON.parse(await readFile("ground-truth/ground-truth.json", "utf8"));

  let totalFields = 0;
  let correctFields = 0;
  const mismatches = [];

  for (const doc of groundTruth.documents) {
    const filePath = path.join("ground-truth/documents", doc.file);
    let content;
    if (doc.mime_type === "application/pdf") {
      const bytes = new Uint8Array(await readFile(filePath));
      const { text } = await extractPdfText(bytes);
      content = { kind: "text", text };
    } else {
      const bytes = await readFile(filePath);
      content = { kind: "image", mediaType: doc.mime_type, base64: bytes.toString("base64") };
    }

    const results = await extractFields(client, TEMPLATE, content);
    console.log(`\n=== ${doc.id} (${doc.kind}) ===`);
    for (const result of results) {
      const expected = doc.fields[result.key];
      const ok = matches(result.rawValue, expected);
      totalFields++;
      if (ok) correctFields++;
      else mismatches.push({ doc: doc.id, field: result.key, expected, actual: result.rawValue });
      console.log(
        `  ${result.key.padEnd(15)} expected=${JSON.stringify(expected)} actual=${JSON.stringify(result.rawValue)} confidence=${result.modelConfidence} ${ok ? "OK" : "MISMATCH"}`,
      );
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(
    `${correctFields}/${totalFields} fields matched (${((correctFields / totalFields) * 100).toFixed(1)}%)`,
  );
  if (mismatches.length > 0) {
    console.log(`\nMismatches:`);
    for (const m of mismatches) {
      console.log(
        `  ${m.doc}.${m.field}: expected=${JSON.stringify(m.expected)} actual=${JSON.stringify(m.actual)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
