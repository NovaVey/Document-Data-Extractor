// Runs before every test file (vitest.config.ts's setupFiles), not just
// jsdom ones — harmless for node-environment tests since it only extends
// Vitest's `expect` with jest-dom's DOM matchers (toBeInTheDocument(),
// etc.), it doesn't touch any DOM API itself. Keeping one global setup
// file (rather than scoping it to component tests only) means adding a
// second .test.tsx file later never requires touching this config again.
import "@testing-library/jest-dom/vitest";
