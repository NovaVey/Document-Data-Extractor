"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeMember, updateMemberRole } from "./actions";

// Two-step inline confirm for Remove, same pattern as
// delete-template-button.tsx — a single accidental click on an
// irreversible, org-membership-affecting action deserves the same guard
// that already exists for templates.
export function MemberRowActions({ userId, role }: { userId: string; role: "owner" | "member" }) {
  const router = useRouter();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRoleToggle() {
    setError(null);
    const nextRole = role === "owner" ? "member" : "owner";
    startTransition(async () => {
      const result = await updateMemberRole(userId, nextRole);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeMember(userId);
      if (result?.error) {
        setError(result.error);
        setConfirmingRemove(false);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={handleRoleToggle}
          disabled={isPending || confirmingRemove}
          className="underline underline-offset-2 disabled:opacity-50"
        >
          {role === "owner" ? "Demote to member" : "Promote to owner"}
        </button>

        {confirmingRemove ? (
          <>
            <span>Remove this member?</span>
            <button
              type="button"
              onClick={handleRemove}
              disabled={isPending}
              className="font-medium text-red-600 underline underline-offset-2 disabled:opacity-50 dark:text-red-400"
            >
              {isPending ? "Removing…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              disabled={isPending}
              className="underline underline-offset-2 disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            disabled={isPending}
            className="text-red-600 underline underline-offset-2 disabled:opacity-50 dark:text-red-400"
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
