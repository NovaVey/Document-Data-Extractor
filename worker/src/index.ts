import { tick } from "./tick.js";
import { Sentry } from "./sentry.js";
import { resolveWorkerConcurrency } from "./concurrency.js";

export const POLL_INTERVAL_MS = 5_000;
const STALE_AFTER_MINUTES = 10;

let shuttingDown = false;

// Exposed so a test can stop main()'s otherwise-infinite loop deterministically,
// and so the real SIGINT/SIGTERM handlers below have one place to set this
// rather than reaching into module-private state.
export function requestShutdown(): void {
  shuttingDown = true;
}

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

// Exported (not just self-invoked below) so a test can call this directly
// with WORKER_CONCURRENCY set and a mocked tick() to verify the actual
// wiring — that the concurrency this resolves is really what gets passed
// to Promise.all/Array.from, not just that resolveWorkerConcurrency()
// itself returns the right number in isolation.
export async function main(): Promise<void> {
  const concurrency = resolveWorkerConcurrency();
  console.log(`[worker] starting, ${concurrency} lane(s), polling every`, POLL_INTERVAL_MS, "ms");

  await Promise.all(Array.from({ length: concurrency }, (_, id) => lane(id)));

  console.log("[worker] shut down cleanly");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] received ${signal}, finishing current tick then exiting`);
    requestShutdown();
  });
}

// Only auto-runs when this module is the actual process entrypoint
// (`node dist/index.js`) — not when imported, e.g. by a test importing
// main()/requestShutdown() directly to exercise the real lane-count
// wiring without triggering an infinite loop or real process side effects
// (process.exit(), real signal handler registration still happens either
// way, but main() itself no longer auto-starts on import).
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("[worker] fatal:", err);
    Sentry.captureException(err);
    process.exit(1);
  });
}
