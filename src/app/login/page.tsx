import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/documents");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">Document Data Extractor</h1>
        <LoginForm />
      </div>
    </main>
  );
}
