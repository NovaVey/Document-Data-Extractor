import { Sentry } from "./sentry.js";

// Backlog item flagged in Medium PR F: the worker processed one document
// at a time, in a single serial loop (see index.ts's history) — this is
// the throughput knob for running more than one at once within a single
// process. Default is 1 (identical behavior to before this existed) so an
// existing deployment's throughput and cost-cap behavior never change
// unless an operator explicitly opts in, same convention as every other
// env-var knob in this project (DAILY_COST_CAP_CENTS, REVIEW_CONFIDENCE_
// THRESHOLD): a safe unconfigured default, override without a redeploy.
export const DEFAULT_WORKER_CONCURRENCY = 1;

// A malformed WORKER_CONCURRENCY (typo, empty override, non-integer,
// zero, negative) falling through unnoticed would either crash the
// process (Array.from({ length: NaN }) etc.) or silently run zero lanes
// forever — falling back to the safe default here, with a warning, is the
// same "never let a bad override reach production without saying why the
// worker is behaving differently" discipline as resolveDailyCostCapCents()
// in claim.ts.
export function resolveWorkerConcurrency(): number {
  const raw = process.env.WORKER_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_WORKER_CONCURRENCY;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    const message = `WORKER_CONCURRENCY is set to an invalid value (${JSON.stringify(raw)}); falling back to the default of ${DEFAULT_WORKER_CONCURRENCY} lane(s) instead of running with an invalid lane count`;
    console.error(`[worker] ${message}`);
    Sentry.captureMessage(message, "warning");
    return DEFAULT_WORKER_CONCURRENCY;
  }
  return parsed;
}
