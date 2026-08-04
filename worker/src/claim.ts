import { supabase } from "./supabase.js";
import { Sentry } from "./sentry.js";
import type { DocumentRow } from "./types.js";

// Matches the SQL function's own default (supabase/migrations/
// 20260726000000_daily_cost_cap.sql) — overridable per deployment via
// DAILY_COST_CAP_CENTS without a redeploy of this code or a new migration.
const DEFAULT_DAILY_COST_CAP_CENTS = 500;

// A malformed DAILY_COST_CAP_CENTS (typo, empty override, non-numeric
// value) used to reach claim_next_document() as NaN, which the Supabase
// client's JSON serialization silently turns into `null` on the wire —
// making the SQL cost-cap comparison UNKNOWN for every row, so the queue
// claims nothing for any org, forever, with no error anywhere. Falling
// back to the safe default here isn't optional cosmetics: it's the
// difference between "processing quietly continues at the standard cap"
// and "the entire pipeline silently stops." Surfaced via Sentry too, since
// silently *using* the fallback is still an ops-visible misconfiguration
// worth knowing about, not just worth not crashing on.
function resolveDailyCostCapCents(): number {
  const raw = process.env.DAILY_COST_CAP_CENTS?.trim();
  if (!raw) return DEFAULT_DAILY_COST_CAP_CENTS;

  // Number() on a pure-whitespace string returns 0, not NaN — already
  // excluded above by trimming first, so every value reaching here is a
  // genuine attempt at a number, not just "unset".
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    const message = `DAILY_COST_CAP_CENTS is set to an invalid value (${JSON.stringify(raw)}); falling back to the default of ${DEFAULT_DAILY_COST_CAP_CENTS} cents instead of silently halting the whole queue`;
    console.error(`[worker] ${message}`);
    Sentry.captureMessage(message, "warning");
    return DEFAULT_DAILY_COST_CAP_CENTS;
  }
  return parsed;
}

// Wraps the claim_next_document() Postgres function (supabase/migrations/
// 20260725040000_queue_worker.sql, extended in 20260726000000_daily_cost_cap.sql).
// Has to go through .rpc() rather than a plain .from() query — PostgREST
// has no way to express FOR UPDATE SKIP LOCKED, which is what makes
// concurrent claims safe.
export async function claimNextDocument(staleAfterMinutes = 10): Promise<DocumentRow | null> {
  const dailyCostCapCents = resolveDailyCostCapCents();

  const { data, error } = await supabase.rpc("claim_next_document", {
    stale_after: `${staleAfterMinutes} minutes`,
    daily_cost_cap_cents: dailyCostCapCents,
  });

  if (error) {
    throw new Error(`claim_next_document failed: ${error.message}`);
  }

  const rows = data as DocumentRow[] | null;
  return rows && rows.length > 0 ? rows[0] : null;
}
