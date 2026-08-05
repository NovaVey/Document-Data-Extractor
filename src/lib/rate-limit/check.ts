import type { SupabaseClient } from "@supabase/supabase-js";

// Backlog item flagged in Medium PR F: zero rate limiting existed anywhere
// in the app. Thin wrapper around the check_rate_limit() Postgres function
// (supabase/migrations/20260805010000_rate_limiting.sql) — see that
// migration for why this lives in Postgres rather than a new piece of
// external infrastructure (Redis/Upstash) this project has never needed.
//
// `window` is a Postgres interval literal, same convention already used
// for claim_next_document()'s `stale_after` parameter (worker/src/claim.ts)
// — e.g. "10 minutes".
//
// Fails OPEN (returns true, lets the request through) if the check itself
// errors — a rate limiter that can take the whole app down whenever its
// own plumbing hiccups would be a worse outcome than occasionally letting
// a burst through, especially since every action this guards already has
// its own real invariant underneath (unique constraints, RLS, the daily
// cost cap) regardless of this limiter.
export async function checkRateLimit(
  supabase: SupabaseClient,
  action: string,
  maxHits: number,
  window: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_action: action,
    p_max_hits: maxHits,
    p_window: window,
  });

  if (error) {
    console.error(`[rate-limit] check_rate_limit failed for action "${action}": ${error.message}`);
    return true;
  }

  return data === true;
}

// A short, consistent message across every rate-limited action — a caller
// hitting this doesn't need to know which specific bucket they tripped,
// just that they should slow down.
export const RATE_LIMIT_MESSAGE =
  "You're doing that too quickly — please wait a bit and try again.";
