import { tick } from "./tick.js";
import { Sentry } from "./sentry.js";

const POLL_INTERVAL_MS = 5_000;
const STALE_AFTER_MINUTES = 10;

let shuttingDown = false;

async function main(): Promise<void> {
  console.log("[worker] starting, polling every", POLL_INTERVAL_MS, "ms");

  while (!shuttingDown) {
    try {
      await tick(STALE_AFTER_MINUTES);
    } catch (err) {
      console.error("[worker] tick error:", err instanceof Error ? err.message : err);
      Sentry.captureException(err);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  console.log("[worker] shut down cleanly");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] received ${signal}, finishing current tick then exiting`);
    shuttingDown = true;
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  Sentry.captureException(err);
  process.exit(1);
});
