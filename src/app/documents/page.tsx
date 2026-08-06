import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/org";
import { statusLabel } from "@/lib/documents/status";
import { resolveDailyCostCapCents } from "@/lib/documents/cost-cap";
import { friendlyDbError } from "@/lib/errors/friendly";
import { signOut } from "./actions";
import { UploadForm } from "./upload-form";
import { FilterForm } from "./filter-form";

type SearchParams = { status?: string; template?: string; q?: string; page?: string };

// Unbounded before this: the queue query fetched every matching row with
// no cap, so the page's response size and render cost grew linearly with
// an org's total document count forever — fine at demo scale (12 rows),
// not fine as a real deployment accumulates months of uploads. 25 is a
// reasonable default table page size: enough to browse without a second
// click most of the time, small enough that render cost stays flat
// regardless of how many documents an org has accumulated.
const PAGE_SIZE = 25;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { status, template, q, page: pageParam } = await searchParams;
  const supabase = await createClient();
  const membership = await getCurrentMembership();
  const orgId = membership?.orgId ?? null;

  // Guards against a non-numeric, negative, or zero page param (typed by
  // hand or a stale bookmark from before the page count shrank) rather
  // than letting a malformed range() call reach Postgres as a confusing
  // error — falls back to page 1, the same as omitting it entirely.
  const parsedPage = Number(pageParam);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const rangeStart = (page - 1) * PAGE_SIZE;
  const rangeEnd = rangeStart + PAGE_SIZE - 1;

  // No org_id filter here, deliberately: RLS is what scopes this query to
  // the caller's org, not application code. If RLS were ever misconfigured
  // or disabled, this same query would start leaking every org's rows —
  // which is exactly the property that makes RLS worth verifying directly.
  // Filters are applied on top of that, not instead of it.
  //
  // { count: "exact" } asks PostgREST for the total matching row count
  // alongside the page of data, in the same request — needed to render
  // "Page X of Y" and to know whether a Next link should exist.
  let query = supabase
    .from("documents")
    .select("id, original_filename, status, uploaded_at, template_id", { count: "exact" })
    .order("uploaded_at", { ascending: false })
    .range(rangeStart, rangeEnd);

  if (status) query = query.eq("status", status);
  if (template) query = query.eq("template_id", template);
  if (q) query = query.ilike("original_filename", `%${q}%`);

  const { data: documents, count: totalCount, error } = await query;
  const totalPages = totalCount != null ? Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) : null;

  // Errors on these two are captured too (not just the main list query
  // above) — a failed templates fetch used to render identically to
  // "this org genuinely has no templates yet" (empty array either way),
  // and a failed cost query used to silently show "$0.00 of $5.00" as if
  // nothing had been spent, both misleading during a real outage.
  const { data: templates, error: templatesError } = await supabase
    .from("extraction_templates")
    .select("id, name")
    .order("name");

  const templateNameById = new Map((templates ?? []).map((t) => [t.id, t.name]));
  const hasFilters = Boolean(status || template || q);

  // RLS already scopes extraction_runs to the caller's org (via a join to
  // documents), same as every other query on this page — no separate
  // org_id filter needed. "Today" is approximated as UTC midnight; the
  // actual cap enforcement in claim_next_document() uses the database's
  // own current_date, which this display doesn't need to match to the
  // second — it's informational, not the enforcement itself.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data: costRows, error: costError } = await supabase
    .from("extraction_runs")
    .select("cost_cents")
    .gte("created_at", todayStart.toISOString());
  const todaysCostCents = (costRows ?? []).reduce((sum, row) => sum + (row.cost_cents ?? 0), 0);
  const dailyCostCapCents = resolveDailyCostCapCents();

  // Medium-priority audit finding: nothing distinguished "no uploads
  // today" from "the worker has been silently down for six hours" — see
  // worker/src/index.ts's recordHeartbeat() for what writes this row.
  // WORKER_STALE_AFTER_MS is generous relative to POLL_INTERVAL_MS (5s):
  // wide enough to absorb a normal Railway redeploy/restart without a
  // false alarm, tight enough to still catch a real outage well before a
  // reviewer would otherwise notice documents silently piling up in
  // `queued`.
  const WORKER_STALE_AFTER_MS = 2 * 60 * 1000;
  const { data: heartbeatRow } = await supabase
    .from("worker_heartbeat")
    .select("last_tick_at")
    .eq("id", true)
    .maybeSingle();
  // new Date().getTime() rather than Date.now() -- the lint rule guarding
  // render purity (react-hooks/purity) flags Date.now() specifically as
  // an impure call, same reasoning todayStart above already works around
  // by going through `new Date()`.
  const workerStale =
    !heartbeatRow ||
    new Date().getTime() - new Date(heartbeatRow.last_tick_at).getTime() > WORKER_STALE_AFTER_MS;

  const exportParams = new URLSearchParams();
  if (template) exportParams.set("template", template);
  if (q) exportParams.set("q", q);
  const exportFilterParams = exportParams.size > 0 ? `&${exportParams.toString()}` : "";

  // Preserves the active filters across a page link — only `page` itself
  // changes. Omits page=1 so the common "first page" link stays a plain
  // /documents?status=... URL rather than always carrying a redundant
  // page=1.
  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (template) params.set("template", template);
    if (q) params.set("q", q);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/documents?${qs}` : "/documents";
  }

  // A page number beyond the actual result count — a stale bookmark, or
  // hand-edited URL, after filters or total row count changed — reads
  // very differently from "this org/filter genuinely has zero documents",
  // so it gets its own message with a way back rather than reusing either
  // empty-state copy.
  const isPageOverflow = !error && documents?.length === 0 && page > 1 && (totalCount ?? 0) > 0;

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Documents</h1>
        <div className="flex items-center gap-4">
          <Link href="/templates" className="text-sm underline underline-offset-2">
            Templates
          </Link>
          {membership?.role === "owner" && (
            <Link href="/settings/members" className="text-sm underline underline-offset-2">
              Members
            </Link>
          )}
          <form action={signOut}>
            <button type="submit" className="text-sm underline underline-offset-2">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {costError ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          Could not load today&apos;s extraction cost:{" "}
          {friendlyDbError(costError, "please refresh the page.")}
        </p>
      ) : (
        <p className="text-xs text-black/60 dark:text-white/60">
          Today&apos;s extraction cost: ${(todaysCostCents / 100).toFixed(2)} of $
          {(dailyCostCapCents / 100).toFixed(2)}
          {todaysCostCents >= dailyCostCapCents && (
            <span className="ml-2 font-medium text-amber-700 dark:text-amber-400">
              Daily cap reached — new documents will wait until it resets.
            </span>
          )}
        </p>
      )}

      {/* Only shown when actually stale -- a healthy worker adds no
          permanent clutter to a page reviewers load constantly, same
          reasoning as every other conditional warning on this page. */}
      {workerStale && (
        <p role="alert" className="text-xs font-medium text-amber-700 dark:text-amber-400">
          {heartbeatRow
            ? `The extraction worker hasn't reported in since ${new Date(heartbeatRow.last_tick_at).toLocaleString()} — new uploads may sit in the queue longer than usual.`
            : "The extraction worker has never reported in — new uploads may sit in the queue indefinitely."}
        </p>
      )}

      {templatesError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Could not load templates: {friendlyDbError(templatesError, "please refresh the page.")}
        </p>
      )}

      {orgId ? (
        <UploadForm orgId={orgId} templates={templates ?? []} />
      ) : (
        <p className="text-sm text-red-600 dark:text-red-400">
          No organization membership found — uploads are disabled.
        </p>
      )}

      <FilterForm
        status={status}
        template={template}
        q={q}
        templates={templates ?? []}
        hasFilters={hasFilters}
      />

      {/* Export always scopes to approved documents only, regardless of
          the status filter above — carries the template/filename filters
          through since those still make sense for "export this subset". */}
      <div className="flex items-center gap-4 text-sm">
        <a
          href={`/documents/export?format=csv${exportFilterParams}`}
          className="underline underline-offset-2"
        >
          Export CSV
        </a>
        <a
          href={`/documents/export?format=xlsx${exportFilterParams}`}
          className="underline underline-offset-2"
        >
          Export XLSX
        </a>
        <span className="text-xs text-black/60 dark:text-white/60">(approved documents only)</span>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {friendlyDbError(error, "Could not load documents. Please refresh the page.")}
        </p>
      )}

      {isPageOverflow && (
        <p className="text-sm text-black/60 dark:text-white/60">
          No documents on page {page} —{" "}
          <Link href={pageHref(1)} className="underline underline-offset-2">
            back to page 1
          </Link>
          .
        </p>
      )}

      {!error && !isPageOverflow && documents?.length === 0 && (
        <p className="text-sm text-black/60 dark:text-white/60">
          {hasFilters ? "No documents match these filters." : "No documents yet."}
        </p>
      )}

      {!error && documents && documents.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/60 dark:border-white/15 dark:text-white/60">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Filename
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Template
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Uploaded
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr
                  key={document.id}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  <td className="py-2 pr-4">
                    <Link
                      href={`/documents/${document.id}`}
                      className="underline underline-offset-2"
                    >
                      {document.original_filename}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-black/60 dark:text-white/60">
                    {(document.template_id && templateNameById.get(document.template_id)) ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-black/60 dark:text-white/60">
                    {statusLabel(document.status)}
                  </td>
                  <td className="py-2 pr-4 text-black/60 dark:text-white/60">
                    {new Date(document.uploaded_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && documents && documents.length > 0 && totalPages && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-black/60 dark:text-white/60">
            Page {page} of {totalPages} ({totalCount} document{totalCount === 1 ? "" : "s"})
          </span>
          <div className="flex items-center gap-4">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="underline underline-offset-2">
                Previous
              </Link>
            ) : (
              <span className="text-black/30 dark:text-white/30">Previous</span>
            )}
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="underline underline-offset-2">
                Next
              </Link>
            ) : (
              <span className="text-black/30 dark:text-white/30">Next</span>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
