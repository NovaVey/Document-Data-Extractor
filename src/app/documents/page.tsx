import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function DocumentsPage() {
  const supabase = await createClient();

  // No org_id filter here, deliberately: RLS is what scopes this query to
  // the caller's org, not application code. If RLS were ever misconfigured
  // or disabled, this same query would start leaking every org's rows —
  // which is exactly the property that makes RLS worth verifying directly.
  const { data: documents, error } = await supabase
    .from("documents")
    .select("id, original_filename, status, uploaded_at")
    .order("uploaded_at", { ascending: false });

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Documents</h1>
        <form action={signOut}>
          <button type="submit" className="text-sm underline underline-offset-2">
            Sign out
          </button>
        </form>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>}

      {!error && documents?.length === 0 && (
        <p className="text-sm text-black/60 dark:text-white/60">No documents yet.</p>
      )}

      {!error && documents && documents.length > 0 && (
        <ul className="flex flex-col gap-2">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-center justify-between rounded border border-black/10 px-4 py-3 dark:border-white/15"
            >
              <span>{document.original_filename}</span>
              <span className="text-xs text-black/60 dark:text-white/60">{document.status}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
