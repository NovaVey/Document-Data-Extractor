import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Phase 1 has no pure business logic to unit test yet (thin Supabase
    // client/proxy wrappers only) — real coverage starts in Phase 3 with
    // the deterministic validators and confidence scoring.
    passWithNoTests: true,
  },
});
