import { supabase } from "./supabase.js";
import { anthropic } from "./anthropic.js";
import { extractPdfText } from "./extraction/pdf-text.js";
import { extractFields } from "./extraction/extract.js";
import { validateFields } from "./validation/validate.js";
import { scoreFields } from "./scoring/score.js";
import { needsAttention } from "./scoring/threshold.js";
import type { DocumentRow } from "./types.js";
import type { ExtractionContent, TemplateField } from "./extraction/types.js";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Every processed document lands in 'needs_review', never an auto-approved
// state — that's the actual point of this project, not a placeholder to
// outgrow. The confidence threshold decides which *fields* get flagged for
// a reviewer's attention (used below only for a summary count — there's no
// review UI yet to route a per-field flag into, that's item 10), not
// whether a document skips a human being involved at all.
//
// Never logs document contents or field values, only metadata and counts.
export async function processDocument(document: DocumentRow): Promise<void> {
  console.log(`[worker] processing ${document.id} (${document.original_filename})`);

  if (!document.template_id) {
    throw new Error(`document ${document.id} has no template assigned`);
  }

  const { data: template, error: templateError } = await supabase
    .from("extraction_templates")
    .select("fields")
    .eq("id", document.template_id)
    .single();

  if (templateError || !template) {
    throw new Error(
      `failed to load template ${document.template_id}: ${templateError?.message ?? "not found"}`,
    );
  }

  const fields = template.fields as TemplateField[];

  const { data: file, error: downloadError } = await supabase.storage
    .from("documents")
    .download(document.storage_path);

  if (downloadError || !file) {
    throw new Error(
      `failed to download ${document.storage_path}: ${downloadError?.message ?? "empty file"}`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const content = await buildContent(document.mime_type, bytes);

  const extracted = await extractFields(anthropic, fields, content);
  const validations = validateFields(fields, extracted);
  const scored = scoreFields(extracted, validations);
  const flaggedCount = scored.filter((field) => needsAttention(field.finalConfidence)).length;

  const { error: insertError } = await supabase.from("extracted_fields").insert(
    scored.map((field) => ({
      document_id: document.id,
      field_key: field.key,
      raw_value: field.rawValue,
      normalized_value: field.normalizedValue,
      model_confidence: field.modelConfidence,
      validation_status: field.validationStatus,
      validation_notes: field.validationNotes,
      final_confidence: field.finalConfidence,
    })),
  );

  if (insertError) {
    throw new Error(`failed to insert extracted fields for ${document.id}: ${insertError.message}`);
  }

  const { error: updateError } = await supabase
    .from("documents")
    .update({ status: "needs_review", processed_at: new Date().toISOString() })
    .eq("id", document.id);

  if (updateError) {
    throw new Error(`failed to update document ${document.id}: ${updateError.message}`);
  }

  console.log(
    `[worker] finished ${document.id} -> needs_review (${flaggedCount}/${scored.length} fields below review threshold)`,
  );
}

async function buildContent(mimeType: string, bytes: Uint8Array): Promise<ExtractionContent> {
  if (mimeType === "application/pdf") {
    const { text } = await extractPdfText(bytes);
    return { kind: "text", text };
  }

  if (SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    return {
      kind: "image",
      mediaType: mimeType as "image/png" | "image/jpeg" | "image/webp",
      base64: Buffer.from(bytes).toString("base64"),
    };
  }

  throw new Error(`unsupported mime type: ${mimeType}`);
}
