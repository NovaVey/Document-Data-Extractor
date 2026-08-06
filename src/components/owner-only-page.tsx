// Medium-priority audit finding: this exact "full page replaced by a
// single permission message" shape was hand-duplicated 3x — templates/
// new/page.tsx, templates/[id]/edit/page.tsx, and settings/members/
// page.tsx — each a direct navigation guard (bookmark, typed URL) for a
// page whose New/Edit/Members entry points are already hidden from a
// non-owner elsewhere in the UI. templates/page.tsx's own inline notice is
// deliberately NOT converted to this — that page keeps rendering its
// template list below the notice, a different shape than these three
// early-return pages.
export function OwnerOnlyPage({ title, action }: { title: string; action: string }) {
  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Only an organization owner can {action}.
      </p>
    </main>
  );
}
