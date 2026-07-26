import * as Sentry from "@sentry/nextjs";

// Runs with dsn undefined until NEXT_PUBLIC_SENTRY_DSN is set (Railway env
// var, added once a real Sentry project exists) — the SDK no-ops safely
// without a DSN rather than erroring, so this is safe to ship ahead of that.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
