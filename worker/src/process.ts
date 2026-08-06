import { supabase } from "./supabase.js";
import { anthropic } from "./anthropic.js";
import { extractPdfText } from "./extraction/pdf-text.js";
import { extractFields, MODEL } from "./extraction/extract.js";
import { computeCostCents } from "./extraction/cost.js";
import { validateFields } from "./validation/validate.js";
import { scoreFields } from "./scoring/score.js";
import { needsAttention, resolveReviewConfidenceThreshold } from "./scoring/threshold.js";
import type { DocumentRow } from "./types.js";
import type { ExtractionContent, TemplateField } from "./extraction/types.js";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Refreshes processing_started_at while a document is genuinely still being
// worked on, well under claim_next_document()'s stale_after window
// (10 minutes by default) — without this, a real API call that happens to
// run long stays vulnerable to being reclaimed by a *second* concurrent
// worker tick while the first is still alive, wasting a duplicate Claude
// call and racing both runs' final writes against each other. This alone
// only reduces how often reclaim-while-alive happens; the extracted_fields
// upsert below (not a plain insert) is what makes an actual reclaim-and-
// reprocess — genuine crash recovery, or a rare race this heartbeat
// doesn't close — safe rather than merely rare.
const HEARTBEAT_INTERVAL_MS = 2 * 60_000;

function startHeartbeat(documentId: string): ReturnType<typeof setInterval> {
  return setInterval(() => {
    supabase
      .from("documents")
      .update({ processing_started_at: new Date().toISOString() })
      .eq("id", documentId)
      .then(({ error }) => {
        if (error) {
          console.error(`[worker] heartbeat failed for ${documentId}: ${error.message}`);
        }
      });
  }, HEARTBEAT_INTERVAL_MS);
}

// Every processed document lands in 'needs_review', never an auto-approved
// state — that's the actual point of this project, not a placeholder to
// outgrow. The confidence threshold decides which *fields* get flagged for
// a reviewer's attention (used below only for a summary count — there's no
// review UI yet to route a per-field flag into, that's item 10), not
// whether a document skips a human being involved at all.
//
// Never logs document contents or field values, only metadata and counts.
export async function processDocument(document: DocumentRow): Promise<void> {
  const heartbeat = startHeartbeat(document.id);
  try {
    await processDocumentInner(document);
  } finally {
    clearInterval(heartbeat);
  }
}

async function processDocumentInner(document: DocumentRow): Promise<void> {
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

  const startedAt = Date.now();
  const {
    fields: extracted,
    inputTokens,
    outputTokens,
  } = await extractFields(anthropic, fields, content);
  const durationMs = Date.now() - startedAt;

  // Logged as soon as the call itself succeeds, before validation/scoring/
  // persistence — real money was spent on this call regardless of what
  // happens next, and item 17's cost cap needs that recorded even if a
  // later step throws and the document ends up 'failed'.
  const { count: priorAttempts } = await supabase
    .from("extraction_runs")
    .select("id", { count: "exact", head: true })
    .eq("document_id", document.id);

  const { error: runError } = await supabase.from("extraction_runs").insert({
    document_id: document.id,
    // Denormalized (supabase/migrations/20260806030000_index_cost_cap_lookup.sql)
    // so claim_next_document()'s per-org daily cost-cap check can filter
    // on an indexed column instead of joining through documents on every
    // candidate row it examines. Safe to denormalize here specifically
    // because extraction_runs rows are insert-only — nothing ever updates
    // one after creation — so this can never drift out of sync the way a
    // mutable denormalized column could.
    org_id: document.org_id,
    attempt: (priorAttempts ?? 0) + 1,
    model: MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_cents: computeCostCents(inputTokens, outputTokens),
    duration_ms: durationMs,
  });

  if (runError) {
    throw new Error(`failed to log extraction run for ${document.id}: ${runError.message}`);
  }

  const validations = validateFields(fields, extracted);
  const scored = scoreFields(extracted, validations);
  const confidenceThreshold = resolveReviewConfidenceThreshold();
  const flaggedCount = scored.filter((field) =>
    needsAttention(field.finalConfidence, confidenceThreshold),
  ).length;

  // Upsert, not a plain insert: a reclaimed-and-reprocessed document (stale
  // recovery, or a race the heartbeat above doesn't fully close) must
  // overwrite its own prior attempt's rows rather than duplicate them.
  // Requires the unique (document_id, field_key) index added in
  // supabase/migrations/20260727010000_idempotent_field_writes.sql. Safe to
  // overwrite unconditionally: reprocessing only ever happens while status
  // is still 'queued'/'processing', never 'needs_review', so there's no
  // window where a human correction could already exist on these rows.
  const { error: insertError } = await supabase.from("extracted_fields").upsert(
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
    { onConflict: "document_id,field_key" },
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
