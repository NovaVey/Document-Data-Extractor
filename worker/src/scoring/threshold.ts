import { Sentry } from "../sentry.js";

// Tuned against the ground-truth run (worker/ground-truth): every field
// that extracted and validated correctly there scored between 0.95 and 1.0
// model confidence — that's the model's normal range when it's actually
// sure of a reading. 0.9 sits with headroom below that observed floor, so
// a field is only flagged when the model itself was meaningfully less
// certain than usual, not merely a hair off a clean result.
//
// Ground truth alone can't supply a true "wrong but still validator-
// passing" case to tune a precise cutoff against — it's all correct
// documents by construction (see worker/ground-truth/README.md). That gap
// is real, not hidden: the synthetic proof case in threshold.test.ts is
// what stands in for it, not a claim that this number was derived from
// observed failures.
//
// Any field that fails validation is already forced to 0 by
// computeFinalConfidence (item 8) and so is always caught here regardless
// of the exact number chosen — this threshold's only real job is the
// valid-but-not-confident case validators can't see at all.
export const REVIEW_CONFIDENCE_THRESHOLD = 0.9;

export function needsAttention(
  finalConfidence: number,
  threshold: number = REVIEW_CONFIDENCE_THRESHOLD,
): boolean {
  return finalConfidence < threshold;
}

// Medium-priority audit finding (product/ops): this threshold was a bare
// constant duplicated across this file, src/lib/review/threshold.ts (the
// app), and (as a hardcoded literal) approve_document(). Overridable via
// REVIEW_CONFIDENCE_THRESHOLD without a redeploy of code or a new
// migration, mirroring resolveDailyCostCapCents() in ../claim.ts exactly.
// This worker-side copy only ever feeds a log line (process.ts's
// flaggedCount), never a persisted decision — the actual enforcement
// lives in approve_document() (supabase/migrations/
// 20260804020000_configurable_review_threshold.sql), which the app's
// Server Action resolves and passes in separately. Kept configurable here
// too so the worker's own log output stays consistent with whatever
// threshold is actually configured, rather than silently drifting from it.
export function resolveReviewConfidenceThreshold(): number {
  const raw = process.env.REVIEW_CONFIDENCE_THRESHOLD?.trim();
  if (!raw) return REVIEW_CONFIDENCE_THRESHOLD;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    const message = `REVIEW_CONFIDENCE_THRESHOLD is set to an invalid value (${JSON.stringify(raw)}); falling back to the default of ${REVIEW_CONFIDENCE_THRESHOLD}`;
    console.error(`[worker] ${message}`);
    Sentry.captureMessage(message, "warning");
    return REVIEW_CONFIDENCE_THRESHOLD;
  }
  return parsed;
}
