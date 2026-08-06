"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateFields, type TemplateField } from "@/lib/templates/types";
import { requireOwnerMembership } from "@/lib/org";
import { friendlyDbError } from "@/lib/errors/friendly";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit/check";

// Generous relative to real usage (a template is edited far less often
// than documents are uploaded) — mainly a guard against a scripted loop,
// not something a person editing templates by hand would ever notice.
const TEMPLATE_WRITE_MAX_HITS = 30;
const TEMPLATE_WRITE_WINDOW = "10 minutes";

const NOT_AN_OWNER_ERROR = "Only an organization owner can manage templates.";

// Returns { error } instead of throwing for expected failures (bad input,
// a Postgres constraint) — Next.js redacts thrown Server Action error
// messages in production ("An error occurred in the Server Components
// render..."), so throwing here would hide the actual validation/DB
// message from the reviewer instead of showing it in the form.
export async function createTemplate(
  name: string,
  fields: TemplateField[],
): Promise<{ error: string } | undefined> {
  const fieldsError = validateFields(fields);
  if (fieldsError) return { error: fieldsError };

  const supabase = await createClient();

  // Fast-fail ahead of the real enforcement (the INSERT policy in
  // supabase/migrations/20260805010000_role_enforcement.sql requires
  // is_writable_org_owner()) — a crafted request can't skip it, this just
  // turns that into a clear message instead of a raw RLS-violation error.
  const ownerCheck = await requireOwnerMembership(NOT_AN_OWNER_ERROR);
  if ("error" in ownerCheck) return { error: ownerCheck.error };
  const { membership } = ownerCheck;

  const allowed = await checkRateLimit(
    supabase,
    "template_write",
    TEMPLATE_WRITE_MAX_HITS,
    TEMPLATE_WRITE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  const { error: insertError } = await supabase.from("extraction_templates").insert({
    org_id: membership.orgId,
    name,
    fields,
  });
  if (insertError) {
    return {
      error: friendlyDbError(insertError, "Couldn't create the template. Please try again."),
    };
  }

  revalidatePath("/templates");
  redirect("/templates");
}

export async function updateTemplate(
  id: string,
  name: string,
  fields: TemplateField[],
): Promise<{ error: string } | undefined> {
  const fieldsError = validateFields(fields);
  if (fieldsError) return { error: fieldsError };

  const supabase = await createClient();

  const ownerCheck = await requireOwnerMembership(NOT_AN_OWNER_ERROR);
  if ("error" in ownerCheck) return { error: ownerCheck.error };

  const allowed = await checkRateLimit(
    supabase,
    "template_write",
    TEMPLATE_WRITE_MAX_HITS,
    TEMPLATE_WRITE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  // Chained .select().maybeSingle() (rather than a bare .update()) so an
  // update the RLS policy's using() clause silently matches zero rows for
  // — e.g. the app-level owner check above got bypassed some other way,
  // or the id belongs to a different org entirely — surfaces as a real
  // error instead of a false "saved" with nothing actually changed.
  const { data: updated, error: updateError } = await supabase
    .from("extraction_templates")
    .update({ name, fields })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (updateError) {
    return {
      error: friendlyDbError(
        updateError,
        "Couldn't save changes to the template. Please try again.",
      ),
    };
  }
  if (!updated) {
    return {
      error:
        "Couldn't save changes to the template. It may not exist, or you may not have permission.",
    };
  }

  revalidatePath("/templates");
  redirect("/templates");
}

export async function deleteTemplate(id: string): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const ownerCheck = await requireOwnerMembership(NOT_AN_OWNER_ERROR);
  if ("error" in ownerCheck) return { error: ownerCheck.error };

  const allowed = await checkRateLimit(
    supabase,
    "template_write",
    TEMPLATE_WRITE_MAX_HITS,
    TEMPLATE_WRITE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  // Same .select().maybeSingle() reasoning as updateTemplate above.
  const { data: deleted, error } = await supabase
    .from("extraction_templates")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    // documents.template_id -> extraction_templates(id) is ON DELETE RESTRICT
    // (Phase 2 decision): a template with documents still pointing at it
    // can't be deleted, by design — surface that plainly instead of a raw
    // Postgres foreign-key error.
    if (error.code === "23503") {
      return { error: "This template is used by existing documents and can't be deleted." };
    }
    return { error: friendlyDbError(error, "Couldn't delete the template. Please try again.") };
  }
  if (!deleted) {
    return {
      error: "Couldn't delete the template. It may not exist, or you may not have permission.",
    };
  }

  revalidatePath("/templates");
  return undefined;
}
