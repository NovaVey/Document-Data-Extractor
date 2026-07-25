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

export function needsAttention(finalConfidence: number): boolean {
  return finalConfidence < REVIEW_CONFIDENCE_THRESHOLD;
}
