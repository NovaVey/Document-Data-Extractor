// Mirrors worker/src/scoring/threshold.ts (same rationale as the
// TemplateField duplication in src/lib/templates/types.ts: small, changes
// rarely, and the app has no build-time dependency on the worker package).
// If this number ever needs to change, change it in both places.
export const REVIEW_CONFIDENCE_THRESHOLD = 0.9;

export function needsAttention(
  finalConfidence: number,
  threshold: number = REVIEW_CONFIDENCE_THRESHOLD,
): boolean {
  return finalConfidence < threshold;
}

// Medium-priority audit finding (product/ops): this threshold was a bare
// constant duplicated across this file, worker/src/scoring/threshold.ts,
// and (as a hardcoded literal) approve_document() -- no way to tune it
// per deployment without editing and redeploying code in three places.
// Overridable via REVIEW_CONFIDENCE_THRESHOLD without a redeploy of code
// or a new migration, mirroring worker/src/claim.ts's
// resolveDailyCostCapCents() exactly: a malformed override reaching
// downstream unnoticed would be worse than falling back to the documented
// default. Server-only (reads process.env directly) -- a "use client"
// component must receive the resolved number as a prop from a Server
// Component caller, never call this itself, since a plain (non-
// NEXT_PUBLIC_) env var doesn't reach the browser.
export function resolveReviewConfidenceThreshold(): number {
  const raw = process.env.REVIEW_CONFIDENCE_THRESHOLD?.trim();
  if (!raw) return REVIEW_CONFIDENCE_THRESHOLD;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    console.error(
      `[app] REVIEW_CONFIDENCE_THRESHOLD is set to an invalid value (${JSON.stringify(raw)}); falling back to the default of ${REVIEW_CONFIDENCE_THRESHOLD} instead of an out-of-range gate`,
    );
    return REVIEW_CONFIDENCE_THRESHOLD;
  }
  return parsed;
}
