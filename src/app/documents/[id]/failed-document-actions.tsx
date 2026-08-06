"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryDocument, deleteDocument } from "./actions";

// High-priority finding from the 2026-08-06 fresh audit: a failed
// document had no retry or delete affordance anywhere in the app. Two-
// step confirm on Delete only (irreversible), same pattern as
// delete-template-button.tsx — Retry is safely re-triggerable, so it
// doesn't need one.
export function FailedDocumentActions({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRetry() {
    setError(null);
    startTransition(async () => {
      const result = await retryDocument(documentId);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteDocument(documentId);
      // No `result` (undefined) means the delete succeeded and redirected
      // — this component has already been torn down by the time that
      // happens, same convention as template-form.tsx's onSubmit.
      if (result?.error) {
        setError(result.error);
        setConfirmingDelete(false);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={handleRetry}
          disabled={isPending || confirmingDelete}
          className="rounded border border-black/10 px-3 py-1 text-xs disabled:opacity-50 dark:border-white/15"
        >
          {isPending && !confirmingDelete ? "Retrying…" : "Retry"}
        </button>

        {confirmingDelete ? (
          <>
            <span className="text-xs">Delete this document?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="text-xs font-medium text-red-600 underline underline-offset-2 disabled:opacity-50 dark:text-red-400"
            >
              {isPending ? "Deleting…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={isPending}
              className="text-xs underline underline-offset-2 disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={isPending}
            className="text-xs text-red-600 underline underline-offset-2 disabled:opacity-50 dark:text-red-400"
          >
            Delete
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
