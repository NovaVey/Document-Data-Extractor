import * as Sentry from "@sentry/node";

// Safe to import unconditionally even before a real Sentry project exists:
// Sentry.init() with dsn undefined no-ops rather than erroring. No document
// content ever reaches an error report — every error message this worker
// produces already carries only metadata (ids, filenames, statuses), never
// field values or raw file bytes.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0,
});

export { Sentry };
