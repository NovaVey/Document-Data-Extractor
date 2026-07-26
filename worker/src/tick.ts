import { claimNextDocument } from "./claim.js";
import { processDocument } from "./process.js";
import { supabase } from "./supabase.js";
import { Sentry } from "./sentry.js";

// Runs one queue iteration: claim the next document (if any) and process
// it. A thrown error from processDocument() is caught here and turns into
// a 'failed' status on that one document — it must never propagate out of
// tick(), or one bad document (corrupt file, locked PDF, a downstream API
// error) would take the whole worker process down and block every other
// queued document behind it. (A crashed *worker process* — not a caught
// error — is instead recovered by claim_next_document()'s stale-processing
// check, a separate mechanism.)
export async function tick(staleAfterMinutes = 10): Promise<void> {
  const document = await claimNextDocument(staleAfterMinutes);
  if (!document) {
    return;
  }

  try {
    await processDocument(document);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] failed ${document.id}: ${message}`);
    Sentry.captureException(err, { extra: { documentId: document.id } });
    await supabase
      .from("documents")
      .update({ status: "failed", error_message: message })
      .eq("id", document.id);
  }
}
