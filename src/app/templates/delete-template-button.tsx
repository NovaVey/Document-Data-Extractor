"use client";

import { useState, useTransition } from "react";
import { deleteTemplate } from "./actions";

// Two-step inline confirm rather than window.confirm(): a single accidental
// click on "Delete" (which used to fire deleteTemplate directly) causes
// irreversible data loss for any unused template, and this sits right next
// to the equally-styled "Edit" link where a mis-click is easy. The confirm
// step itself is disarmed by clicking anywhere else that re-renders this
// button away from its confirming state (list refresh) or by the explicit
// Cancel — no separate "click outside to dismiss" wiring needed since a
// successful delete already unmounts this component via revalidatePath.
export function DeleteTemplateButton({ templateId }: { templateId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteTemplate(templateId);
      if (result?.error) {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">Delete this template?</span>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className="text-sm font-medium text-red-600 underline underline-offset-2 disabled:opacity-50 dark:text-red-400"
          >
            {isPending ? "Deleting…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="text-sm underline underline-offset-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-red-600 underline underline-offset-2 dark:text-red-400"
      >
        Delete
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
