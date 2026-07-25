import { claimNextDocument } from "./claim.js";
import { processDocument } from "./process.js";
import { supabase } from "./supabase.js";

const POLL_INTERVAL_MS = 5_000;
const STALE_AFTER_MINUTES = 10;

let shuttingDown = false;

async function tick(): Promise<void> {
  const document = await claimNextDocument(STALE_AFTER_MINUTES);
  if (!document) {
    return;
  }

  try {
    await processDocument(document);
  } catch (err) {
    // A crashed/thrown attempt must not leave the row stuck in
    // 'processing' forever — mark it failed rather than silently losing
    // it. (A crashed *worker process* — not a caught error — is instead
    // recovered by claim_next_document()'s stale-processing check.)
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] failed ${document.id}: ${message}`);
    await supabase
      .from("documents")
      .update({ status: "failed", error_message: message })
      .eq("id", document.id);
  }
}

async function main(): Promise<void> {
  console.log("[worker] starting, polling every", POLL_INTERVAL_MS, "ms");

  while (!shuttingDown) {
    try {
      await tick();
    } catch (err) {
      console.error("[worker] tick error:", err instanceof Error ? err.message : err);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  console.log("[worker] shut down cleanly");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] received ${signal}, finishing current tick then exiting`);
    shuttingDown = true;
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
