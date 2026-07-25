import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Phase 1 has no pure business logic to unit test yet (thin Supabase
    // client/proxy wrappers only) — real coverage starts in Phase 3 with
    // the deterministic validators and confidence scoring.
    passWithNoTests: true,
    // worker/ is a separate package with its own vitest config and test
    // runner (npm test run from worker/) — without this, vitest's default
    // include glob picks up worker/test/*.test.ts too, but resolves
    // relative fixture paths from the repo root instead of worker/,
    // where those tests actually expect to run from. Vitest's `exclude`
    // replaces its defaults rather than extending them, so those are
    // repeated here alongside the worker/** addition.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      "worker/**",
    ],
  },
});
