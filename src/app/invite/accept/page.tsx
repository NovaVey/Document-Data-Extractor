"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// This page is reached with no session cookie at all — Supabase's invite
// link redirects here carrying the new session either as a URL hash
// fragment (`#access_token=...`) or a `?code=` param, neither of which
// the server (proxy.ts's middleware) ever sees: a fragment is never sent
// over HTTP at all, and a bare `code` param isn't a session by itself.
// The browser Supabase client's own detectSessionInUrl (on by default)
// parses whichever form shows up and establishes the session entirely
// client-side before this component's first getUser() call resolves —
// that's why proxy.ts has to treat this route as public rather than
// requiring a session to reach it, and why this can't be a Server
// Component the way every other page in this app is.
type Status = "checking" | "ready" | "invalid";

// Medium-priority audit finding: if session establishment genuinely never
// resolves (a malformed/tampered link, a Supabase-side hiccup), "checking"
// had no way out — the page would say "Verifying your invite link…"
// forever with no error and no way forward. This is generous relative to
// the SDK's own URL-detection (normally resolves within one tick, see the
// onAuthStateChange comment below) while still bounding the wait to
// something a real person won't sit through wondering if the page is
// broken.
const VERIFICATION_TIMEOUT_MS = 10_000;

export default function AcceptInvitePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled && data.user) setStatus("ready");
    });

    // Covers a session that gets established slightly after the initial
    // getUser() check above (e.g. the SDK's URL-detection resolves on the
    // next tick) — without this, a real invite link could occasionally
    // land on "invalid" through no fault of the link itself.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session?.user) setStatus("ready");
    });

    // Neither check above ever explicitly sets "invalid" — a genuinely
    // broken link just never produces a session, so without this timeout
    // "checking" was the terminal state for that case, not a transient one.
    const timeoutId = setTimeout(() => {
      if (!cancelled) setStatus((current) => (current === "checking" ? "invalid" : current));
    }, VERIFICATION_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    router.push("/documents");
    router.refresh();
  }

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">Accept your invitation</h1>

        {/* aria-live so the checking -> ready/invalid transition gets
            announced -- unlike every other async status change in this
            app (document review's status poller, the review panel's
            approve gate), this one previously had none: a screen-reader
            user landed on "Verifying your invite link…" and had no signal
            when it resolved either way, since nothing else on the page
            changes focus or otherwise draws attention to it. */}
        <div aria-live="polite">
          {status === "checking" && (
            <p className="text-sm text-black/60 dark:text-white/60">Verifying your invite link…</p>
          )}

          {status === "invalid" && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              This invite link is invalid or has expired. Ask whoever invited you to send a new one.
            </p>
          )}
        </div>

        {status === "ready" && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-black/60 dark:text-white/60">
              Choose a password to finish setting up your account.
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="confirm-password" className="text-sm font-medium">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {submitting ? "Setting password…" : "Set password and continue"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
