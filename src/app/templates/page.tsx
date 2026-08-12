import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/org";
import { friendlyDbError } from "@/lib/errors/friendly";
import { signOut } from "@/app/documents/actions";
import { DeleteTemplateButton } from "./delete-template-button";
import type { TemplateField } from "@/lib/templates/types";

export default async function TemplatesPage() {
  const supabase = await createClient();

  const { data: templates, error } = await supabase
    .from("extraction_templates")
    .select("id, name, fields, created_at")
    .order("created_at", { ascending: false });

  // Templates are shared org-wide configuration — role enforcement
  // (Medium PR F backlog item, supabase/migrations/20260805010000_role_enforcement.sql)
  // restricts creating/editing/deleting them to owners. isOwner also gates
  // the New/Edit/Delete affordances below so a member never lands on a
  // form that's only going to reject their submission — the real
  // enforcement is still server-side (this is just the entry points).
  const membership = await getCurrentMembership();
  const isOwner = membership?.role === "owner";

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Templates</h1>
        <div className="flex items-center gap-4">
          <Link href="/documents" className="text-sm underline underline-offset-2">
            Documents
          </Link>
          {isOwner && (
            <Link href="/settings/members" className="text-sm underline underline-offset-2">
              Members
            </Link>
          )}
          {isOwner && (
            <Link
              href="/templates/new"
              className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background"
            >
              New template
            </Link>
          )}
          {/* Each page hand-rolls its own header rather than sharing one
              component, and this link only ever got added to /documents'
              — a member landing on /templates or /settings/members
              directly had no way to sign out short of navigating back to
              Documents first. Caught live reviewing demo screenshots. */}
          <form action={signOut}>
            <button type="submit" className="text-sm underline underline-offset-2">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {friendlyDbError(error, "Could not load templates. Please refresh the page.")}
        </p>
      )}

      {!isOwner && (
        <p className="text-sm text-black/60 dark:text-white/60">
          Only an organization owner can create, edit, or delete templates.
        </p>
      )}

      {!error && templates?.length === 0 && (
        <p className="text-sm text-black/60 dark:text-white/60">
          No templates yet. Create one to start uploading documents against it.
        </p>
      )}

      {!error && templates && templates.length > 0 && (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => {
            const fields = (template.fields as TemplateField[]) ?? [];
            return (
              <li
                key={template.id}
                className="flex items-center justify-between rounded border border-black/10 px-4 py-3 dark:border-white/15"
              >
                <div>
                  <div className="font-medium">{template.name}</div>
                  <div className="text-xs text-black/60 dark:text-white/60">
                    {fields.length} field{fields.length === 1 ? "" : "s"}:{" "}
                    {fields.map((f) => f.key).join(", ")}
                  </div>
                </div>
                {isOwner && (
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/templates/${template.id}/edit`}
                      className="text-sm underline underline-offset-2"
                    >
                      Edit
                    </Link>
                    <DeleteTemplateButton templateId={template.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
