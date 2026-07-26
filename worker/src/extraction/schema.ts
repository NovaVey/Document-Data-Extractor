import type Anthropic from "@anthropic-ai/sdk";
import type { TemplateField } from "./types.js";

// Builds a tool schema from the template's field list so Claude's response
// is a structured tool call, not free text to regex out. Every field's
// value is a plain string regardless of its declared type (text/number/
// date/currency) — this is the raw_value the model transcribes verbatim;
// turning "$1,234.00" into a number or a date into ISO-8601 is deterministic
// code's job (item 7), not the model's, so it happens exactly once instead
// of being re-derived (and possibly re-guessed) wherever it's read.
export function buildExtractionTool(fields: TemplateField[]): Anthropic.Tool {
  const properties: Record<string, unknown> = {};

  for (const field of fields) {
    properties[field.key] = {
      type: "object",
      description: describeField(field),
      properties: {
        value: {
          type: "string",
          description:
            "The value exactly as it appears in the document — verbatim, not reformatted or calculated. Empty string if genuinely not present.",
        },
        confidence: {
          type: "number",
          description:
            "0 to 1: how clearly and unambiguously this value appears in the document. 0 if not present.",
        },
      },
      required: ["value", "confidence"],
    };
  }

  return {
    name: "extract_fields",
    description: "Report the extracted value and confidence for every requested field.",
    input_schema: {
      type: "object",
      properties,
      required: fields.map((field) => field.key),
    },
  };
}

function describeField(field: TemplateField): string {
  const parts = [field.label, `(${field.type})`];
  if (field.formatHint) parts.push(`Format: ${field.formatHint}.`);
  if (field.validation) parts.push(`Note: ${field.validation}.`);
  parts.push(field.required ? "Required — should be present." : "Optional.");
  return parts.join(" ");
}
