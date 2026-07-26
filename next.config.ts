import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {/* config options here */};

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // Source-map upload is skipped automatically when SENTRY_AUTH_TOKEN isn't
  // set (no Sentry project exists yet) — org/project only matter once it is.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
