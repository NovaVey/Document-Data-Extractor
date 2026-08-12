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

// Supabase Storage errors never carry a `.code` the way Postgres/PostgREST
// errors do (see friendlyDbError above), so upload-form.tsx's uploadEntry()
// and documents/actions.ts's deleteDocumentForReplace() deliberately show a
// Storage error's raw `.message` rather than routing it through
// friendlyDbError — a genuinely diagnosable failure (session expired,
// quota hit, file too large) shouldn't collapse into one generic fallback.
// One message is still worth intercepting, though: storage.objects is
// RLS-protected by the same is_writable_org_member() predicate as every
// other write path in this app (blocks both a genuine non-member and the
// read-only demo account alike), and a write it rejects surfaces literal
// Postgres wording ("new row violates row-level security policy for
// table \"objects\"") — accurate, but meaningless jargon to whoever's
// looking at it, unlike the friendly text friendlyDbError already gives
// the identical underlying failure (42501/PGRST301) everywhere else in
// this app. Caught live: a real upload attempt against the read-only demo
// account surfaced this raw string with nothing else explaining it.
// Substring match, not an exact-message match — Postgres appends a
// table/policy-name suffix that can vary and isn't worth matching exactly.
export function friendlyStorageError(message: string): string {
  if (/row-level security policy/i.test(message)) {
    return "You don't have permission to do that.";
  }
  return message;
}
