// Default mirrors the SQL function's own default
// (supabase/migrations/20260726000000_daily_cost_cap.sql) and the
// worker's own default (worker/src/claim.ts) — a third place to update if
// that default itself ever changes, since this one is purely for display
// (the app itself never enforces this cap; the database does).
const DEFAULT_DAILY_COST_CAP_CENTS = 500;

// Medium-priority audit finding: this used to be a bare exported constant,
// always 500 regardless of the real enforced cap — a deployment that set
// DAILY_COST_CAP_CENTS to override the worker's actual cap (both
// worker/src/claim.ts's resolveDailyCostCapCents() and
// claim_next_document()'s own default already read that same env var/
// parameter) left this display value silently wrong, showing reviewers a
// cap that wasn't the one actually being enforced. Same bug class
// REVIEW_CONFIDENCE_THRESHOLD was already fixed for (src/lib/review/
// threshold.ts) — mirrors that function's exact shape: a malformed
// override falls back to the documented default rather than reaching the
// page as NaN (`$NaN of $NaN` in the cost banner).
export function resolveDailyCostCapCents(): number {
  const raw = process.env.DAILY_COST_CAP_CENTS?.trim();
  if (!raw) return DEFAULT_DAILY_COST_CAP_CENTS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.error(
      `[app] DAILY_COST_CAP_CENTS is set to an invalid value (${JSON.stringify(raw)}); falling back to the default of ${DEFAULT_DAILY_COST_CAP_CENTS} cents for display`,
    );
    return DEFAULT_DAILY_COST_CAP_CENTS;
  }
  return parsed;
}
