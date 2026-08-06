"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteMember } from "./actions";

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);

    const result = await inviteMember(email, role);

    if (result?.error) {
      setError(result.error);
      setPending(false);
      return;
    }

    setSuccess(`Invited ${email}.`);
    setEmail("");
    setRole("member");
    setPending(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded border border-black/10 p-4 dark:border-white/15"
    >
      <p className="text-sm font-medium">Invite a member</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="invite-email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
            placeholder="teammate@example.com"
            className="rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="invite-role" className="text-sm font-medium">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as "owner" | "member")}
            disabled={pending}
            className="rounded border border-black/15 bg-white px-2 py-2 text-sm text-black dark:border-white/20"
          >
            <option value="member" className="text-black">
              Member
            </option>
            <option value="owner" className="text-black">
              Owner
            </option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-green-600 dark:text-green-400">
          {success}
        </p>
      )}
    </form>
  );
}
