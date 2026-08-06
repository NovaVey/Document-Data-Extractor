import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentMembership } from "@/lib/org";
import { friendlyDbError } from "@/lib/errors/friendly";
import { InviteForm } from "./invite-form";

type MemberRow = {
  userId: string;
  email: string;
  role: "owner" | "member";
  pending: boolean;
};

export default async function MembersPage() {
  const supabase = await createClient();
  const membership = await getCurrentMembership();

  // Role enforcement (Medium PR F backlog item, supabase/migrations/
  // 20260805010000_role_enforcement.sql — this page follows the same
  // "owner manages configuration, everyone does the work" split): member
  // management is owner-only, same as templates. Checked here too, not
  // just in inviteMember() — a member landing on this page directly
  // (bookmark, typed URL) sees a clear message instead of a page that
  // renders and then fails on submit.
  if (membership?.role !== "owner") {
    return (
      <main className="flex flex-1 flex-col gap-6 p-8">
        <h1 className="text-xl font-semibold">Members</h1>
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Only an organization owner can manage members.
        </p>
      </main>
    );
  }

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("org_id", membership.orgId)
    .order("created_at", { ascending: true });

  let members: MemberRow[] = [];
  let membersError: string | null = null;

  if (error) {
    membersError = friendlyDbError(error, "Couldn't load the member list. Please try again.");
  } else {
    // auth.users is never queryable via the RLS-scoped client (not
    // exposed via PostgREST at all) — the admin client is the only way
    // to resolve a member's email/pending-invite status. Sequential
    // lookups (via Promise.all, not a loop) rather than a single batch
    // call: the admin API has no "get many users by id" endpoint, and a
    // real org here is a handful of people, not thousands.
    const admin = createAdminClient();
    members = await Promise.all(
      (memberships ?? []).map(async (m) => {
        const { data } = await admin.auth.admin.getUserById(m.user_id);
        return {
          userId: m.user_id,
          email: data.user?.email ?? "(unknown)",
          role: m.role as "owner" | "member",
          // Set once the invite link is clicked and verified, even before
          // a password is chosen — a reasonable, if imperfect, proxy for
          // "hasn't accepted their invite yet."
          pending: !data.user?.email_confirmed_at,
        };
      }),
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        <div className="flex items-center gap-4">
          <Link href="/documents" className="text-sm underline underline-offset-2">
            Documents
          </Link>
          <Link href="/templates" className="text-sm underline underline-offset-2">
            Templates
          </Link>
        </div>
      </div>

      <InviteForm />

      {membersError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {membersError}
        </p>
      )}

      {!membersError && (
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between rounded border border-black/10 px-4 py-3 dark:border-white/15"
            >
              <div>
                <div className="font-medium">
                  {member.email}
                  {member.userId === currentUser?.id && (
                    <span className="ml-2 text-xs text-black/60 dark:text-white/60">(you)</span>
                  )}
                </div>
                <div className="text-xs text-black/60 dark:text-white/60">
                  {member.role}
                  {member.pending && (
                    <span className="ml-2 text-amber-700 dark:text-amber-400">
                      Invited — hasn&apos;t accepted yet
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
