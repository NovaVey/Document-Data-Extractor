import { getCurrentMembership } from "@/lib/org";
import { NewTemplateForm } from "./new-template-form";

// Role enforcement (Medium PR F backlog item, supabase/migrations/
// 20260805010000_role_enforcement.sql): creating templates is owner-only.
// Checked here too, not just in createTemplate() — a member landing on
// this page directly (the "New template" link is already hidden for them
// on /templates, but a bookmark or typed URL still reaches this route)
// sees a clear message instead of a form that will only fail on submit.
export default async function NewTemplatePage() {
  const membership = await getCurrentMembership();

  if (membership?.role !== "owner") {
    return (
      <main className="flex flex-1 flex-col gap-6 p-8">
        <h1 className="text-xl font-semibold">New template</h1>
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Only an organization owner can create templates.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <h1 className="text-xl font-semibold">New template</h1>
      <NewTemplateForm />
    </main>
  );
}
