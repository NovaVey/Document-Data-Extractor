import Link from "next/link";

// Next.js renders this for any route that calls notFound() (e.g. a
// document/template id that doesn't exist, or belongs to another org and
// so is invisible under RLS) or that simply doesn't match any route at
// all. Before this file existed, both cases fell through to Next's own
// generic 404 page -- unstyled, no connection to this app, and no way
// back in short of editing the URL by hand.
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/documents" className="text-sm underline underline-offset-2">
        Back to documents
      </Link>
    </main>
  );
}
