import type Anthropic from "@anthropic-ai/sdk";
import { buildExtractionTool } from "./schema.js";
import type { ExtractedField, ExtractionContent, TemplateField } from "./types.js";

export const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You are extracting structured data from a scanned business document (an invoice, receipt, or similar work order). You will be given the document's content and a list of fields to find.

For each field, transcribe the value exactly as it appears in the document. Do not reformat dates, strip currency symbols, recalculate totals, or otherwise "clean up" the value — a later step handles that. If a field is genuinely not present anywhere in the document, report an empty string and a confidence of 0 rather than guessing.

Call extract_fields exactly once with your findings for every requested field.`;

export type ExtractionResult = {
  fields: ExtractedField[];
  inputTokens: number;
  outputTokens: number;
};

// Returns token usage alongside the extracted fields — item 17's per-org
// cost cap has to know what each real call actually cost, and this is the
// one place that number is available (Anthropic's response, not something
// derivable afterward).
export async function extractFields(
  client: Anthropic,
  fields: TemplateField[],
  content: ExtractionContent,
): Promise<ExtractionResult> {
  const tool = buildExtractionTool(fields);

  const userContent: Anthropic.MessageParam["content"] =
    content.kind === "text"
      ? [{ type: "text", text: content.text }]
      : [
          {
            type: "image",
            source: { type: "base64", media_type: content.mediaType, data: content.base64 },
          },
        ];

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("extract_fields tool was not called");
  }

  const input = toolUse.input as Record<string, { value?: string; confidence?: number }>;

  const extractedFields = fields.map((field) => {
    const result = input[field.key];
    return {
      key: field.key,
      rawValue: result?.value ?? "",
      modelConfidence: result?.confidence ?? 0,
    };
  });

  return {
    fields: extractedFields,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}
