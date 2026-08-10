import Link from "next/link";
import { signOut } from "@/app/documents/actions";

// Medium-priority audit finding: this exact "full page replaced by a
// single permission message" shape was hand-duplicated 3x — templates/
// new/page.tsx, templates/[id]/edit/page.tsx, and settings/members/
// page.tsx — each a direct navigation guard (bookmark, typed URL) for a
// page whose New/Edit/Members entry points are already hidden from a
// non-owner elsewhere in the UI. templates/page.tsx's own inline notice is
// deliberately NOT converted to this — that page keeps rendering its
// template list below the notice, a different shape than these three
// early-return pages.
//
// Every caller of this component is, by construction, a non-owner (each
// call site only reaches it after its own `role !== "owner"` check) —
// so the nav below never needs an isOwner branch: no Members link (a
// member can't reach that page either) and no New/Edit affordance,
// just a way back to the two pages a member can actually use, plus
// Sign out. Without this, a member landing here directly (bookmark or
// typed URL — the entry points that lead here are already hidden
// elsewhere) was stranded on a page with no navigation chrome at all.
// Caught live reviewing demo screenshots.
export function OwnerOnlyPage({ title, action }: { title: string; action: string }) {
  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex items-center gap-4">
          <Link href="/documents" className="text-sm underline underline-offset-2">
            Documents
          </Link>
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
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Only an organization owner can {action}.
      </p>
    </main>
  );
}
