"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 5000;
const IN_FLIGHT_STATUSES = new Set(["uploaded", "queued", "processing"]);

// A document sitting in the queue moves through uploaded -> queued ->
// processing -> needs_review/failed entirely on the worker's own clock --
// nothing pushes that change to a reviewer who already has this page
// open, so before this it took a manual reload to notice a document had
// finished (or failed). Polls router.refresh() -- a re-fetch of this
// Server Component's own data over the existing RSC connection, not a
// full page reload or client-side data layer of its own -- every 5s while
// the status is still in-flight, and stops itself the moment the parent
// re-renders with a terminal-for-this-purpose status. Renders nothing;
// this is a side-effect-only component.
export function DocumentStatusPoller({ status }: { status: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!IN_FLIGHT_STATUSES.has(status)) return;
    const id = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, router]);

  return null;
}
