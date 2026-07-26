"use client";

import { useState, useTransition } from "react";
import { deleteTemplate } from "./actions";

export function DeleteTemplateButton({ templateId }: { templateId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteTemplate(templateId);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="text-sm text-red-600 underline underline-offset-2 disabled:opacity-50 dark:text-red-400"
      >
        Delete
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
