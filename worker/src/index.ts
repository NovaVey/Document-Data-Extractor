import { tick } from "./tick.js";
import { Sentry } from "./sentry.js";
import { resolveWorkerConcurrency } from "./concurrency.js";

const POLL_INTERVAL_MS = 5_000;
const STALE_AFTER_MINUTES = 10;

let shuttingDown = false;

// One independent claim-process-sleep loop. claim_next_document() already
// serializes concurrent claims safely (FOR UPDATE SKIP LOCKED, see
// supabase/migrations/20260725040000_queue_worker.sql) — multiple lanes
// calling it at once can never double-claim the same row, so running more
// than one lane is purely a throughput change, not a correctness one.
//
// One real trade-off concurrency does introduce: the per-org daily cost
// cap (claim_next_document()'s own daily_cost_cap_cents check) is
// evaluated at claim time against extraction_runs rows already written —
// it can't see a cost that hasn't been logged yet, and cost is only known
// after the Claude call for a claimed document finishes. With N lanes
// claiming concurrently, up to N documents already in flight can each
// have passed the cap check before any of them logs its cost, so an
// org's actual daily spend can overshoot the configured cap by up to
// roughly (N - 1) times a single document's typical cost before the next
// claim sees the updated total — bounded, not unbounded, and it shrinks
// back to exact enforcement the moment claims serialize again. This is
// why WORKER_CONCURRENCY defaults to 1 (see concurrency.ts): raising it
// is an explicit trade of a wider cap-overshoot window for more
// throughput, not something this worker does silently.
//
// Every lane shares the same shutdown flag, so SIGINT/SIGTERM below still
// drains all of them before the process exits.
async function lane(id: number): Promise<void> {
  while (!shuttingDown) {
    try {
      await tick(STALE_AFTER_MINUTES);
    } catch (err) {
      console.error(`[worker] lane ${id} tick error:`, err instanceof Error ? err.message : err);
      Sentry.captureException(err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  const concurrency = resolveWorkerConcurrency();
  console.log(
    `[worker] starting, ${concurrency} lane(s), polling every`,
    POLL_INTERVAL_MS,
    "ms",
  );

  await Promise.all(Array.from({ length: concurrency }, (_, id) => lane(id)));

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
  Sentry.captureException(err);
  process.exit(1);
});
