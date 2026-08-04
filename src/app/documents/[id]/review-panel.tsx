"use client";

import { useState, useTransition } from "react";
import { approveDocument, saveCorrection } from "./actions";
import { needsAttention } from "@/lib/review/threshold";
import type { TemplateField } from "@/lib/templates/types";

export type ExtractedFieldRow = {
  field_key: string;
  raw_value: string | null;
  normalized_value: string | null;
  model_confidence: number | null;
  final_confidence: number | null;
  validation_status: string | null;
  validation_notes: string | null;
  was_corrected: boolean;
  corrected_value: string | null;
};

type FieldState = { value: string; wasCorrected: boolean };

// Local field state is seeded once from the server-fetched rows and then
// updated optimistically on each successful save — simpler than trying to
// reconcile it with re-fetched props after every server action, and
// sufficient here since the one prop that actually has to reflect fresh
// server state (documentStatus, to hide the whole editing UI once
// approved) is read directly rather than mirrored into local state.
export function ReviewPanel({
  documentId,
  documentStatus,
  templateFields,
  extractedFields,
}: {
  documentId: string;
  documentStatus: string;
  templateFields: TemplateField[];
  extractedFields: ExtractedFieldRow[];
}) {
  const fieldsByKey = new Map(extractedFields.map((field) => [field.field_key, field]));

  const [fieldState, setFieldState] = useState<Record<string, FieldState>>(() =>
    Object.fromEntries(
      templateFields.map((field) => {
        const extracted = fieldsByKey.get(field.key);
        return [
          field.key,
          {
            value: extracted?.corrected_value ?? extracted?.raw_value ?? "",
            wasCorrected: extracted?.was_corrected ?? false,
          },
        ];
      }),
    ),
  );
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [approveError, setApproveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isReviewable = documentStatus === "needs_review";

  function handleSave(fieldKey: string) {
    const value = fieldState[fieldKey]?.value ?? "";
    setFieldError((prev) => ({ ...prev, [fieldKey]: "" }));
    startTransition(async () => {
      const result = await saveCorrection(documentId, fieldKey, value);
      if (result?.error) {
        setFieldError((prev) => ({ ...prev, [fieldKey]: result.error }));
      } else {
        setFieldState((prev) => ({ ...prev, [fieldKey]: { value, wasCorrected: true } }));
      }
    });
  }

  function handleApprove() {
    setApproveError(null);
    startTransition(async () => {
      const result = await approveDocument(documentId);
      if (result?.error) {
        setApproveError(result.error);
      }
    });
  }

  const unresolvedCount = templateFields.filter((field) => {
    const extracted = fieldsByKey.get(field.key);
    const finalConfidence = extracted?.final_confidence ?? null;
    const corrected = fieldState[field.key]?.wasCorrected ?? false;
    return finalConfidence !== null && needsAttention(finalConfidence) && !corrected;
  }).length;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {templateFields.map((field) => {
          const extracted = fieldsByKey.get(field.key);
          const finalConfidence = extracted?.final_confidence ?? null;
          const state = fieldState[field.key];
          const flagged =
            finalConfidence !== null && needsAttention(finalConfidence) && !state?.wasCorrected;
          const rawValue = extracted?.raw_value?.trim() ?? "";
          const showNormalized =
            extracted?.normalized_value != null && extracted.normalized_value !== rawValue;

          return (
            <li
              key={field.key}
              className={`rounded border px-4 py-3 ${
                flagged
                  ? "border-amber-500/50 bg-amber-50 dark:bg-amber-950/20"
                  : "border-black/10 dark:border-white/15"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{field.label}</span>
                <span className="flex gap-2">
                  {flagged && (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      Needs attention
                    </span>
                  )}
                  {state?.wasCorrected && (
                    <span className="text-xs font-medium text-green-700 dark:text-green-400">
                      Corrected
                    </span>
                  )}
                </span>
              </div>

              {isReviewable ? (
                <div className="mt-1 flex gap-2">
                  <input
                    value={state?.value ?? ""}
                    onChange={(e) =>
                      setFieldState((prev) => ({
                        ...prev,
                        [field.key]: { value: e.target.value, wasCorrected: false },
                      }))
                    }
                    className="flex-1 rounded border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15"
                  />
                  <button
                    type="button"
                    onClick={() => handleSave(field.key)}
                    disabled={isPending}
                    className="rounded border border-black/10 px-3 py-1 text-xs disabled:opacity-50 dark:border-white/15"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <p className="text-sm">
                  {state?.value || (
                    <span className="text-black/60 dark:text-white/60">(not found)</span>
                  )}
                </p>
              )}

              {fieldError[field.key] && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {fieldError[field.key]}
                </p>
              )}

              {showNormalized && (
                <p className="text-xs text-black/60 dark:text-white/60">
                  Normalized: {extracted!.normalized_value}
                </p>
              )}

              {extracted?.validation_status && extracted.validation_status !== "valid" && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {extracted.validation_notes}
                </p>
              )}

              {finalConfidence !== null && (
                <p className="text-xs text-black/60 dark:text-white/60">
                  Confidence: {(finalConfidence * 100).toFixed(0)}%
                  {extracted?.validation_status !== "valid" &&
                    extracted?.model_confidence != null && (
                      <> (model said {(extracted.model_confidence * 100).toFixed(0)}%)</>
                    )}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {isReviewable && (
        <div className="flex flex-col items-start gap-2 border-t border-black/10 pt-3 dark:border-white/15">
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending || unresolvedCount > 0}
            className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Approve
          </button>
          {unresolvedCount > 0 && (
            <p aria-live="polite" className="text-xs text-amber-700 dark:text-amber-400">
              {unresolvedCount} field(s) still need review before this document can be approved.
            </p>
          )}
          {approveError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {approveError}
            </p>
          )}
        </div>
      )}

      {documentStatus === "approved" && (
        <p aria-live="polite" className="text-sm text-green-700 dark:text-green-400">
          Approved.
        </p>
      )}
    </div>
  );
}
