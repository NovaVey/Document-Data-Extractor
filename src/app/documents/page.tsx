import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org";
import { statusLabel } from "@/lib/documents/status";
import { DAILY_COST_CAP_CENTS } from "@/lib/documents/cost-cap";
import { signOut } from "./actions";
import { UploadForm } from "./upload-form";
import { FilterForm } from "./filter-form";

type SearchParams = { status?: string; template?: string; q?: string };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { status, template, q } = await searchParams;
  const supabase = await createClient();
  const orgId = await getCurrentOrgId();

  // No org_id filter here, deliberately: RLS is what scopes this query to
  // the caller's org, not application code. If RLS were ever misconfigured
  // or disabled, this same query would start leaking every org's rows —
  // which is exactly the property that makes RLS worth verifying directly.
  // Filters are applied on top of that, not instead of it.
  let query = supabase
    .from("documents")
    .select("id, original_filename, status, uploaded_at, template_id")
    .order("uploaded_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (template) query = query.eq("template_id", template);
  if (q) query = query.ilike("original_filename", `%${q}%`);

  const { data: documents, error } = await query;

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

  const exportParams = new URLSearchParams();
  if (template) exportParams.set("template", template);
  if (q) exportParams.set("q", q);
  const exportFilterParams = exportParams.size > 0 ? `&${exportParams.toString()}` : "";

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Documents</h1>
        <div className="flex items-center gap-4">
          <Link href="/templates" className="text-sm underline underline-offset-2">
            Templates
          </Link>
          <form action={signOut}>
            <button type="submit" className="text-sm underline underline-offset-2">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {costError ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          Could not load today&apos;s extraction cost: {costError.message}
        </p>
      ) : (
        <p className="text-xs text-black/60 dark:text-white/60">
          Today&apos;s extraction cost: ${(todaysCostCents / 100).toFixed(2)} of $
          {(DAILY_COST_CAP_CENTS / 100).toFixed(2)}
          {todaysCostCents >= DAILY_COST_CAP_CENTS && (
            <span className="ml-2 font-medium text-amber-700 dark:text-amber-400">
              Daily cap reached — new documents will wait until it resets.
            </span>
          )}
        </p>
      )}

      {templatesError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Could not load templates: {templatesError.message}
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

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>}

      {!error && documents?.length === 0 && (
        <p className="text-sm text-black/60 dark:text-white/60">
          {hasFilters ? "No documents match these filters." : "No documents yet."}
        </p>
      )}

      {!error && documents && documents.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/60 dark:border-white/15 dark:text-white/60">
                <th className="py-2 pr-4 font-medium">Filename</th>
                <th className="py-2 pr-4 font-medium">Template</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Uploaded</th>
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
    </main>
  );
}
