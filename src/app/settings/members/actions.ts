"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentMembership } from "@/lib/org";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit/check";

// Generous relative to real usage (inviting a whole team is a handful of
// clicks, not a loop) — mainly a guard against a scripted flood of
// invite emails (a real cost/abuse surface, unlike most of this app's
// other rate-limited actions) rather than something an owner adding
// people one at a time would ever notice.
const MEMBER_INVITE_MAX_HITS = 20;
const MEMBER_INVITE_WINDOW = "10 minutes";

const NOT_AN_OWNER_ERROR = "Only an organization owner can manage members.";

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
