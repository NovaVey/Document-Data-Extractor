// Placeholder Sonnet pricing as of this writing — Anthropic's published
// per-model rates change over time, so this is the one place to update
// when they do. extraction_runs.cost_cents is an integer column, so this
// necessarily rounds to the nearest whole cent; summed daily totals may
// drift a fraction of a cent from Anthropic's own billing. That's fine
// for a cost *cap* deciding whether to keep processing, not for
// reconciling an actual invoice.
const INPUT_COST_CENTS_PER_MILLION_TOKENS = 300; // $3.00 / million input tokens
const OUTPUT_COST_CENTS_PER_MILLION_TOKENS = 1500; // $15.00 / million output tokens

export function computeCostCents(inputTokens: number, outputTokens: number): number {
  const cents =
    (inputTokens * INPUT_COST_CENTS_PER_MILLION_TOKENS) / 1_000_000 +
    (outputTokens * OUTPUT_COST_CENTS_PER_MILLION_TOKENS) / 1_000_000;
  return Math.round(cents);
}
