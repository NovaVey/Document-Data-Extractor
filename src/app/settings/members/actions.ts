"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentMembership } from "@/lib/org";
import { friendlyDbError } from "@/lib/errors/friendly";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit/check";

// Generous relative to real usage (inviting a whole team is a handful of
// clicks, not a loop) — mainly a guard against a scripted flood of
// invite emails (a real cost/abuse surface, unlike most of this app's
// other rate-limited actions) rather than something an owner adding
// people one at a time would ever notice.
const MEMBER_INVITE_MAX_HITS = 20;
const MEMBER_INVITE_WINDOW = "10 minutes";

// Separate bucket/limit from invites — remove/demote never sends an
// email or has any external cost, just a guard against a scripted flood
// of membership edits.
const MEMBER_MANAGE_MAX_HITS = 30;
const MEMBER_MANAGE_WINDOW = "10 minutes";

const NOT_AN_OWNER_ERROR = "Only an organization owner can manage members.";
const LAST_OWNER_ERROR =
  "This would leave the organization with no owner. Promote someone else to owner first.";

export async function inviteMember(
  email: string,
  role: "owner" | "member",
): Promise<{ error: string } | undefined> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "No organization membership found" };
  // Fast-fail ahead of anything else below — this action is reachable
  // directly by a crafted request regardless of what the UI shows, and
  // it's the one action in this app that reaches for the service-role
  // client, so the owner check has to hold before that client is ever
  // constructed, not just before the invite email is sent.
  if (membership.role !== "owner") return { error: NOT_AN_OWNER_ERROR };

  if (role !== "owner" && role !== "member") {
    return { error: "Invalid role." };
  }

  const trimmedEmail = email.trim();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return { error: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const allowed = await checkRateLimit(
    supabase,
    "member_invite",
    MEMBER_INVITE_MAX_HITS,
    MEMBER_INVITE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  const siteUrl = resolveSiteUrl();
  if (!siteUrl) {
    return {
      error:
        "This deployment isn't configured to send invites yet (SITE_URL is unset). Contact an administrator.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(trimmedEmail, {
    // Read by handle_new_user() (supabase/migrations/20260806000000_invite_flow.sql)
    // to join this org instead of creating a new one for the invited user.
    data: { invited_org_id: membership.orgId, invited_role: role },
    redirectTo: `${siteUrl}/invite/accept`,
  });

  if (error) {
    // Not routed through friendlyDbError: this is a Supabase Auth API
    // error (e.g. "User already registered"), not a Postgres/PostgREST
    // one — Auth error messages are already written to be user-facing,
    // same reasoning as login-form.tsx's own signInError.message usage.
    return { error: error.message };
  }

  revalidatePath("/settings/members");
  return undefined;
}

// Removes a member's org access. The real enforcement is the DELETE RLS
// policy (supabase/migrations/20260806040000_member_removal.sql) — owner
// -only, and it rejects outright if this row is the org's last owner, so
// a crafted request can't bypass either check. The .select().maybeSingle()
// chain (same reasoning as templates/actions.ts) turns an RLS-blocked
// delete into a real error instead of a silent no-op.
export async function removeMember(userId: string): Promise<{ error: string } | undefined> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "No organization membership found" };
  if (membership.role !== "owner") return { error: NOT_AN_OWNER_ERROR };

  const supabase = await createClient();
  const allowed = await checkRateLimit(
    supabase,
    "member_manage",
    MEMBER_MANAGE_MAX_HITS,
    MEMBER_MANAGE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  // Checked BEFORE deleting the membership: a genuinely pending invite
  // (never clicked, never confirmed) has no real account worth
  // preserving — deleting the orphaned auth user frees the email address
  // for a fresh invite later. An already-active member keeps their auth
  // account; only their org access (the membership row) is revoked.
  const admin = createAdminClient();
  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const wasPending = !userData.user?.email_confirmed_at;

  const { data: deleted, error } = await supabase
    .from("memberships")
    .delete()
    .eq("user_id", userId)
    .eq("org_id", membership.orgId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: friendlyDbError(error, "Couldn't remove that member. Please try again.") };
  }
  if (!deleted) {
    return { error: `Couldn't remove that member. They may not exist, or ${LAST_OWNER_ERROR}` };
  }

  if (wasPending) {
    // Best-effort cleanup, not the actual removal outcome — the
    // membership is already gone (access already revoked) regardless of
    // whether this succeeds. If it fails, a future re-invite to the same
    // email just surfaces Auth's own "already registered" error rather
    // than silently losing the removal that already happened.
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      console.error(
        `[settings/members] failed to clean up pending invite's auth user ${userId}: ${deleteUserError.message}`,
      );
    }
  }

  revalidatePath("/settings/members");
  return undefined;
}

// Promotes or demotes a member. The real enforcement is the UPDATE RLS
// policy's with-check clause (same migration as removeMember above) —
// owner-only, and it rejects a demotion that would leave zero owners.
export async function updateMemberRole(
  userId: string,
  role: "owner" | "member",
): Promise<{ error: string } | undefined> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "No organization membership found" };
  if (membership.role !== "owner") return { error: NOT_AN_OWNER_ERROR };

  if (role !== "owner" && role !== "member") {
    return { error: "Invalid role." };
  }

  const supabase = await createClient();
  const allowed = await checkRateLimit(
    supabase,
    "member_manage",
    MEMBER_MANAGE_MAX_HITS,
    MEMBER_MANAGE_WINDOW,
  );
  if (!allowed) return { error: RATE_LIMIT_MESSAGE };

  const { data: updated, error } = await supabase
    .from("memberships")
    .update({ role })
    .eq("user_id", userId)
    .eq("org_id", membership.orgId)
    .select("id")
    .maybeSingle();

  if (error) {
    return {
      error: friendlyDbError(error, "Couldn't update that member's role. Please try again."),
    };
  }
  if (!updated) {
    return {
      error: `Couldn't update that member's role. They may not exist, or ${LAST_OWNER_ERROR}`,
    };
  }

  revalidatePath("/settings/members");
  return undefined;
}

// SITE_URL is the one piece of config this feature needs that has no safe
// default the way e.g. DAILY_COST_CAP_CENTS does — an invite link has to
// point at the real deployed app or it's useless, and guessing wrong is
// worse than refusing to send it. Falls back to Railway's own
// auto-injected RAILWAY_PUBLIC_DOMAIN (set automatically in the real
// deployment, absent in local dev) so a production deploy doesn't need
// SITE_URL configured redundantly on top of what Railway already
// provides; SITE_URL itself is for local dev/testing or a future move
// off Railway, where nothing would auto-populate the real public domain.
function resolveSiteUrl(): string | null {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) return `https://${railwayDomain}`;

  return null;
}
