import { supabase } from "./supabase.js";
import type { DocumentRow } from "./types.js";

// Matches the SQL function's own default (supabase/migrations/
// 20260726000000_daily_cost_cap.sql) — overridable per deployment via
// DAILY_COST_CAP_CENTS without a redeploy of this code or a new migration.
const DEFAULT_DAILY_COST_CAP_CENTS = 500;

// Wraps the claim_next_document() Postgres function (supabase/migrations/
// 20260725040000_queue_worker.sql, extended in 20260726000000_daily_cost_cap.sql).
// Has to go through .rpc() rather than a plain .from() query — PostgREST
// has no way to express FOR UPDATE SKIP LOCKED, which is what makes
// concurrent claims safe.
export async function claimNextDocument(staleAfterMinutes = 10): Promise<DocumentRow | null> {
  const dailyCostCapCents = process.env.DAILY_COST_CAP_CENTS
    ? Number(process.env.DAILY_COST_CAP_CENTS)
    : DEFAULT_DAILY_COST_CAP_CENTS;

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
