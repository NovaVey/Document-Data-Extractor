import { supabase } from "./supabase.js";
import type { DocumentRow } from "./types.js";

// Placeholder for item 5 (single-document extraction against a fixed
// schema) and items 7-8 (deterministic validators, confidence scoring).
// This skeleton only has to prove the queue mechanics work — claim,
// process, terminal status — not produce a real result yet.
//
// Defaults every processed document to 'needs_review' rather than
// 'approved': until real validation and confidence scoring exist, nothing
// should be able to reach an approved state without a human looking at
// it. That's true to the project's actual point even before the logic
// backing it exists.
//
// Never logs document contents or field values here, only metadata
// (id, filename) — there's nothing else to log yet, but the constraint
// holds once item 5 adds real extracted content.
export async function processDocument(document: DocumentRow): Promise<void> {
  console.log(`[worker] processing ${document.id} (${document.original_filename})`);

  const { error } = await supabase
    .from("documents")
    .update({ status: "needs_review", processed_at: new Date().toISOString() })
    .eq("id", document.id);

  if (error) {
    throw new Error(`failed to update document ${document.id}: ${error.message}`);
  }

  console.log(`[worker] finished ${document.id} -> needs_review`);
}
