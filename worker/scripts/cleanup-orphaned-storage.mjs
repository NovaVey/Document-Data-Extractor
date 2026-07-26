// One-off cleanup: removes two Storage objects left orphaned after their
// `documents` rows were deleted directly via SQL. Direct SQL deletion from
// `storage.objects` is blocked by Supabase's own protective trigger
// (`storage.protect_delete()`) specifically to prevent this half-deleted
// state, so the actual Storage API call has to happen from somewhere with
// real network access to Supabase's data plane — this script, run once via
// the deployed worker service, same as `seed-demo.mjs`.
//
// Not meant to be reused or kept around — delete this file once it's run
// successfully.
//
// Usage (from worker/): SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphaned-storage.mjs

import { supabase } from "../dist/supabase.js";

const PATHS = [
  "79b7e640-9e2b-4237-84c7-1a4846f5c2e7/cdfacae2-d45d-4863-8e87-d705b52088ab-SS_CCD_8.png",
  "79b7e640-9e2b-4237-84c7-1a4846f5c2e7/866b87e1-19de-4589-b2d9-b4434ea756b5-SS_CCD_7.png",
];

async function main() {
  const { data, error } = await supabase.storage.from("documents").remove(PATHS);
  if (error) {
    throw new Error(`storage removal failed: ${error.message}`);
  }
  console.log(`[cleanup] removed ${data.length} object(s):`);
  for (const item of data) {
    console.log(`  ${item.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
