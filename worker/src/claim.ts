import { supabase } from "./supabase.js";
import type { DocumentRow } from "./types.js";

// Wraps the claim_next_document() Postgres function (supabase/migrations/
// 20260725040000_queue_worker.sql). Has to go through .rpc() rather than a
// plain .from() query — PostgREST has no way to express FOR UPDATE SKIP
// LOCKED, which is what makes concurrent claims safe.
export async function claimNextDocument(staleAfterMinutes = 10): Promise<DocumentRow | null> {
  const { data, error } = await supabase.rpc("claim_next_document", {
    stale_after: `${staleAfterMinutes} minutes`,
  });

  if (error) {
    throw new Error(`claim_next_document failed: ${error.message}`);
  }

  const rows = data as DocumentRow[] | null;
  return rows && rows.length > 0 ? rows[0] : null;
}
