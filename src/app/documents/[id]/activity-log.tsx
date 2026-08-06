import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyDbError } from "@/lib/errors/friendly";

type AuditLogRow = {
  id: string;
  event_type: "corrected" | "approved";
  field_key: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_id: string | null;
  created_at: string;
};

// Medium-priority audit finding: document_audit_log (the append-only
// corrections/approvals trail, supabase/migrations/20260727020000_
// document_audit_log.sql) existed purely at the database layer with no UI
// anywhere — only reachable via raw SQL/Postgrest, defeating its own
// stated purpose ("no history" was the exact gap it was built to close,
// and a log nobody can see doesn't actually close it for anyone but a
// database administrator). A plain, read-only <details> section — closed
// by default so it doesn't clutter the page every reviewer loads
// constantly, same reasoning as documents/page.tsx's worker-heartbeat
// warning only rendering when something's actually notable.
export async function ActivityLog({ documentId }: { documentId: string }) {
  const supabase = await createClient();

  // RLS ("org members can view their org's audit log") already scopes
  // this to the caller's org via a join through documents — no separate
  // org_id filter needed, same pattern as every other query in this app.
  const { data: entries, error } = await supabase
    .from("document_audit_log")
    .select("id, event_type, field_key, old_value, new_value, actor_id, created_at")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
        Could not load this document&apos;s activity: {friendlyDbError(error, "please try again.")}
      </p>
    );
  }

  if (!entries || entries.length === 0) {
    return null;
  }

  const rows = entries as AuditLogRow[];

  // Distinct actor_ids, not one lookup per row — a document with many
  // corrections is still authored by a handful of org members at most,
  // same "real org here is a handful of people" reasoning
  // settings/members/page.tsx's own admin lookups already rely on. Safe
  // to use the admin client here without an owner check (the invariant
  // src/lib/supabase/admin.ts documents): authorization for these exact
  // rows was already established by the RLS-scoped select above, this
  // just resolves an id this table stores to the email nothing else in
  // this app can turn it into (auth.users isn't queryable via RLS).
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => !!id))];
  const admin = createAdminClient();
  const emailById = new Map(
    await Promise.all(
      actorIds.map(async (actorId): Promise<[string, string]> => {
        const { data, error: lookupError } = await admin.auth.admin.getUserById(actorId);
        return [
          actorId,
          lookupError || !data.user ? "(unknown)" : (data.user.email ?? "(unknown)"),
        ];
      }),
    ),
  );

  return (
    <details className="rounded border border-black/10 dark:border-white/15">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
        Activity ({rows.length})
      </summary>
      <ul className="flex flex-col gap-2 border-t border-black/10 px-4 py-3 text-xs dark:border-white/15">
        {rows.map((row) => {
          const actorEmail = row.actor_id
            ? (emailById.get(row.actor_id) ?? "(unknown)")
            : "(unknown)";
          return (
            <li key={row.id} className="text-black/70 dark:text-white/70">
              <span className="text-black/50 dark:text-white/50">
                {new Date(row.created_at).toLocaleString()}
              </span>{" "}
              — {actorEmail}{" "}
              {row.event_type === "approved" ? (
                "approved this document"
              ) : (
                <>
                  corrected <span className="font-medium">{row.field_key}</span>:{" "}
                  {row.old_value ? `"${row.old_value}"` : "(empty)"} →{" "}
                  {row.new_value ? `"${row.new_value}"` : "(empty)"}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
