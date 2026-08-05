import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // The app's own "@/*" -> "./src/*" tsconfig path mapping (tsconfig.json)
    // isn't picked up by Vite/Vitest automatically — most existing tests
    // only ever hit it via `import type` (erased at compile time, no real
    // module resolution needed), which is why this was never required
    // before test/upload-form.test.tsx started importing modules that use
    // real runtime "@/..." imports (@/lib/supabase/client, @/lib/org, etc.).
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  test: {
    passWithNoTests: true,
    // Everything defaults to Vitest's node environment (fastest, no DOM
    // overhead) — only component tests that actually render into a DOM
    // (React Testing Library) opt into jsdom, by filename convention
    // rather than a second config file.
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    setupFiles: ["./test/setup-dom.ts"],
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
