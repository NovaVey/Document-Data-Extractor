import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite's default postcss lookup walks up parent directories, and would
  // otherwise find the Next.js app's postcss.config.mjs one level up (repo
  // root) — that file requires @tailwindcss/postcss, which only exists in
  // the app's own node_modules, not the worker's isolated one (CI runs
  // `npm ci` separately per package). worker/ has no CSS of its own to
  // process; this inline empty config stops Vite from searching the
  // filesystem for one at all.
  css: {
    postcss: {},
  },
  test: {
    passWithNoTests: true,
  },
});
