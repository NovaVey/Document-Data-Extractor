"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

// Next.js route-segment error boundary: catches any otherwise-uncaught
// error thrown while rendering a page (or a Client Component nested in
// one) instead of falling through to the framework's own generic
// "Application error: a client-side exception has occurred" page, which
// had zero connection to this app's design and gave a reviewer nothing to
// do but guess at reloading. Must be a Client Component -- this is a Next.js
// requirement for error.tsx, since it needs the reset() callback and an
// effect hook. error.message is safe to show as-is: Next.js already
// redacts the real message server-side before a Server Component render
// error ever reaches this boundary in production ("An error occurred in
// the Server Components render..."), so there's nothing sensitive left to
// accidentally leak by displaying it, and doing so matches this app's own
// standing preference for surfacing real error text over hiding it.
//
// Medium-priority audit finding (product/ops): this boundary only logged
// to the console, even though this app's Sentry setup (src/instrumentation*.ts)
// is otherwise wired up end to end -- Sentry's Next.js SDK does NOT
// auto-capture errors caught by an error.tsx boundary (a well-documented
// gap in how the SDK integrates with the App Router), so without an
// explicit captureException call here, any error a reviewer actually saw
// this screen for was invisible in Sentry, the opposite of every other
// unexpected failure in this codebase.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled route error:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p role="alert" className="text-sm text-black/60 dark:text-white/60">
        {error.message || "An unexpected error occurred."}
      </p>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="rounded border border-black/10 px-3 py-1.5 text-sm dark:border-white/15"
        >
          Try again
        </button>
        <Link href="/documents" className="text-sm underline underline-offset-2">
          Back to documents
        </Link>
      </div>
    </main>
  );
}
