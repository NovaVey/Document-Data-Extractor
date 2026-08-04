"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Catches an error thrown by the root layout itself (font loading, the
// layout component's own render) -- rare here, since layout.tsx is just
// font variables and a wrapper, but the one class of error error.tsx
// above genuinely cannot catch: that boundary lives *inside* the layout
// it would need to render, so a layout failure takes it down too.
// Required by Next.js to define its own <html>/<body>, since the layout
// that would normally provide them is what failed -- and for that same
// reason this can't reuse globals.css's custom-property dark-mode setup
// the way the rest of the app does, so it stays deliberately plain
// (system font, one light-mode-only palette) rather than half-matching
// the real design.
//
// Sentry.captureException here is the officially documented integration
// point for global-error.tsx (Sentry's Next.js SDK does not auto-capture
// App Router error-boundary errors) -- see error.tsx's own comment for
// the same gap one level down.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
        <p role="alert" style={{ fontSize: "0.875rem", color: "rgba(0,0,0,0.6)" }}>
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            borderRadius: "0.25rem",
            border: "1px solid rgba(0,0,0,0.1)",
            padding: "0.375rem 0.75rem",
            fontSize: "0.875rem",
            background: "white",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
