import * as Sentry from "@sentry/nextjs";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      // No document content ever reaches an error report — every thrown
      // error and log message in this codebase already carries only
      // metadata (ids, filenames, statuses), never field values or raw
      // file bytes, so nothing extra needs scrubbing here.
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
