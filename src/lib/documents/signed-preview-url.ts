import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// How long a cached signed URL is served before regenerating — kept
// comfortably under the URL's own validity window (SIGNED_URL_TTL_SECONDS
// in documents/[id]/page.tsx, currently 600s) so a request landing right
// at the edge of this cache window never gets back a URL that's already
// expired.
const SIGNED_URL_CACHE_SECONDS = 300;

// Medium-priority audit finding: the review page's signed preview URL was
// regenerated on every 5s status-poll tick (status-poller.tsx) and every
// single field correction (saveCorrection()'s revalidatePath) — both
// re-render the whole page, which re-ran createSignedUrl() every time —
// even though the underlying file never changes mid-review and the URL
// stays valid for 10 minutes. Real, avoidable Storage API traffic on this
// app's busiest workflow. Cached here, keyed by storage_path (a per-
// document identifier — org id + a random UUID, see upload-form.tsx —
// never guessable and never exposed to a caller who hasn't already read
// it off an RLS-scoped `documents` row), so repeated re-renders within
// the cache window reuse the same URL instead of hitting Storage again.
//
// Uses the admin client, not the caller's own RLS-scoped one:
// unstable_cache's memoized function has to be free of per-request state
// (Next.js disallows reading cookies()/headers() inside it, which
// src/lib/supabase/server.ts's createClient() does internally) so a cache
// hit can be served without re-running the function — and therefore
// without a session — at all. Safe for the same reason
// settings/members/page.tsx already uses the admin client after its own
// owner-only gate: authorization for *this* document was already decided
// by the RLS-scoped `documents` select the caller made to obtain this
// storage_path in the first place (documents/[id]/page.tsx never calls
// this with a path it hasn't already confirmed the caller can see). This
// function only produces a signed download link for a path access to
// which is already established — it makes no authorization decision of
// its own, and every org member (not just owners) reaching the review
// page is expected to be able to call it, unlike the owner-only members
// page's use of the same client.
export const getCachedSignedPreviewUrl = unstable_cache(
  async (storagePath: string, ttlSeconds: number): Promise<string | null> => {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("documents")
      .createSignedUrl(storagePath, ttlSeconds);

    if (error) {
      console.error(
        `[documents] failed to sign a preview URL for ${storagePath}: ${error.message}`,
      );
      return null;
    }
    return data.signedUrl;
  },
  ["document-preview-signed-url"],
  { revalidate: SIGNED_URL_CACHE_SECONDS },
);
