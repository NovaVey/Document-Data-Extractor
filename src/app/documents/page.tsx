import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org";
import { DOCUMENT_STATUSES, statusLabel } from "@/lib/documents/status";
import { signOut } from "./actions";
import { UploadForm } from "./upload-form";

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

  const { data: templates } = await supabase
    .from("extraction_templates")
    .select("id, name")
    .order("name");

  const templateNameById = new Map((templates ?? []).map((t) => [t.id, t.name]));
  const hasFilters = Boolean(status || template || q);

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

      {orgId ? (
        <UploadForm orgId={orgId} templates={templates ?? []} />
      ) : (
        <p className="text-sm text-red-600 dark:text-red-400">
          No organization membership found — uploads are disabled.
        </p>
      )}

      {/* Plain GET form: filters are just a query string, so results are
          shareable/bookmarkable URLs and need no client-side JS. */}
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15"
          >
            <option value="">All</option>
            {DOCUMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Template
          <select
            name="template"
            defaultValue={template ?? ""}
            className="rounded border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15"
          >
            <option value="">All</option>
            {(templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Filename
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search filename"
            className="rounded border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15"
          />
        </label>

        <button
          type="submit"
          className="rounded border border-black/10 px-3 py-1.5 text-sm dark:border-white/15"
        >
          Filter
        </button>
        {hasFilters && (
          <Link href="/documents" className="text-sm underline underline-offset-2">
            Clear
          </Link>
        )}
      </form>

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
