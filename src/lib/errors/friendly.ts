// Backlog item flagged in Medium PR F: several write paths returned a raw
// Postgres/PostgREST error string (`error.message`) straight to the UI —
// e.g. `duplicate key value violates unique constraint
// "documents_org_id_file_hash_key"` or `permission denied for table
// extraction_templates` instead of something a reviewer can act on.
// deleteTemplate() already carved out its own special case for this
// (23503 -> "This template is used by existing documents..."); this just
// generalizes that pattern into one place instead of repeating it.
//
// Deliberately not a single blanket "Something went wrong" for every
// unmapped code: the caller already knows the operation-specific context
// (uploading a document vs. saving a correction) better than this shared
// helper does, so every call site still supplies its own `fallback` for
// codes it doesn't specifically recognize. Only the handful of codes that
// mean roughly the same thing everywhere they occur in this app are
// mapped generically here.
export type DbErrorLike = {
  code?: string | null;
  message: string;
};

export function friendlyDbError(error: DbErrorLike, fallback: string): string {
  switch (error.code) {
    // unique_violation — the app already checks for duplicates ahead of
    // most inserts (e.g. the upload form's own findDuplicateDocument call),
    // so this code path is normally only a race between two near-
    // simultaneous requests, not the common case.
    case "23505":
      return "That already exists — it may have just been created by another request.";
    // insufficient_privilege (raised by Postgres directly) / PGRST301
    // (PostgREST's own "RLS blocked this" code) — surfaced when a
    // database-level check (not just this app's own pre-check) is what
    // actually stopped the request.
    case "42501":
    case "PGRST301":
      return "You don't have permission to do that.";
    default:
      return fallback;
  }
}
