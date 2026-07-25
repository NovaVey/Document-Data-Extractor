// Mirrors worker/src/scoring/threshold.ts (same rationale as the
// TemplateField duplication in src/lib/templates/types.ts: small, changes
// rarely, and the app has no build-time dependency on the worker package).
// If this number ever needs to change, change it in both places.
export const REVIEW_CONFIDENCE_THRESHOLD = 0.9;

export function needsAttention(finalConfidence: number): boolean {
  return finalConfidence < REVIEW_CONFIDENCE_THRESHOLD;
}
