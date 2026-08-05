import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Test-quality gap flagged in review: concurrency.test.ts only unit-tests
// resolveWorkerConcurrency() in isolation — nothing exercised index.ts's
// actual USE of the resolved value. Confirmed by mutation: hardcoding
// index.ts's lane count to 1 (ignoring WORKER_CONCURRENCY entirely) still
// left every existing test passing. This test imports the real main() and
// asserts the real lane count it drives tick() with, closing that gap.
const state = vi.hoisted(() => ({
  tickMock: vi.fn(async () => {}),
}));

vi.mock("../src/tick.js", () => ({
  tick: (...args: unknown[]) => state.tickMock(...args),
}));

vi.mock("../src/sentry.js", () => ({
  Sentry: {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  },
}));

const ORIGINAL_ENV = process.env.WORKER_CONCURRENCY;

beforeEach(() => {
  state.tickMock.mockClear();
  vi.useFakeTimers();
  // index.ts keeps its own shuttingDown flag as module-level state, set
  // permanently true by the previous test's requestShutdown() call — a
  // fresh module instance per test (mocks survive resetModules(), only
  // the module registry cache is cleared) is what gives each test its own
  // shuttingDown = false starting point, not just a fresh import binding.
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_ENV === undefined) {
    delete process.env.WORKER_CONCURRENCY;
  } else {
    process.env.WORKER_CONCURRENCY = ORIGINAL_ENV;
  }
});

// Lets already-queued microtasks (the mocked tick()'s own promise
// resolution) run without needing real time to pass — fake timers only
// fake setTimeout/setInterval, not the microtask queue, so this alone is
// enough to observe tickMock's call count update.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("main() — actual WORKER_CONCURRENCY wiring", () => {
  it("runs exactly WORKER_CONCURRENCY concurrent lanes, each independently calling tick()", async () => {
    process.env.WORKER_CONCURRENCY = "4";
    const { main, requestShutdown, POLL_INTERVAL_MS } = await import("../src/index.js");

    const runPromise = main();
    await flushMicrotasks();

    // All 4 lanes fire their first tick() before any of them reaches
    // sleep() — this is exactly what the earlier hardcoded-to-1 mutation
    // would fail: only 1 call would be observed here instead of 4.
    expect(state.tickMock).toHaveBeenCalledTimes(4);

    // Every lane is now parked in sleep(POLL_INTERVAL_MS) (a real
    // setTimeout, faked). Request shutdown, then advance fake time past
    // that sleep so each lane's loop re-checks shuttingDown and exits,
    // resolving main()'s Promise.all — advanceTimersByTimeAsync (not the
    // sync variant) also flushes microtasks between timer callbacks,
    // which the loop's own async continuation needs.
    requestShutdown();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await runPromise;

    // No further ticks after shutdown was requested and the sleep drained.
    expect(state.tickMock).toHaveBeenCalledTimes(4);
  });

  it("runs a single lane when WORKER_CONCURRENCY is unset (the documented default)", async () => {
    delete process.env.WORKER_CONCURRENCY;
    const { main, requestShutdown, POLL_INTERVAL_MS } = await import("../src/index.js");

    const runPromise = main();
    await flushMicrotasks();
    expect(state.tickMock).toHaveBeenCalledTimes(1);

    requestShutdown();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await runPromise;
  });
});
