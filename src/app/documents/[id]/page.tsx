import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TemplateField } from "@/lib/templates/types";
import { needsAttention } from "@/lib/review/threshold";

type ExtractedFieldRow = {
  field_key: string;
  raw_value: string | null;
  normalized_value: string | null;
  model_confidence: number | null;
  final_confidence: number | null;
  validation_status: string | null;
  validation_notes: string | null;
};

const SIGNED_URL_TTL_SECONDS = 600;
const UNPROCESSED_STATUSES = new Set(["uploaded", "queued", "processing"]);

export default async function DocumentReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // No org_id filter here either, for the same reason as documents/page.tsx
  // — RLS is what makes a cross-org id 404 instead of leaking a row.
  const { data: document } = await supabase
    .from("documents")
    .select(
      "id, original_filename, storage_path, mime_type, status, error_message, template_id, uploaded_at, processed_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!document) {
    notFound();
  }

  const [{ data: template }, { data: extractedFields }, { data: signedUrlData }] =
    await Promise.all([
      document.template_id
        ? supabase
            .from("extraction_templates")
            .select("fields")
            .eq("id", document.template_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("extracted_fields")
        .select(
          "field_key, raw_value, normalized_value, model_confidence, final_confidence, validation_status, validation_notes",
        )
        .eq("document_id", document.id),
      supabase.storage
        .from("documents")
        .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS),
    ]);

  const templateFields = (template?.fields as TemplateField[] | undefined) ?? [];
  const fieldsByKey = new Map(
    ((extractedFields ?? []) as ExtractedFieldRow[]).map((field) => [field.field_key, field]),
  );

  const isProcessed = document.status === "needs_review" || document.status === "approved";

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{document.original_filename}</h1>
        <Link href="/documents" className="text-sm underline underline-offset-2">
          Back to documents
        </Link>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/60 dark:text-white/60">Document</h2>
          {signedUrlData?.signedUrl ? (
            document.mime_type === "application/pdf" ? (
              <iframe
                src={signedUrlData.signedUrl}
                title={document.original_filename}
                className="h-[70vh] w-full rounded border border-black/10 dark:border-white/15"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset Next can optimize
              <img
                src={signedUrlData.signedUrl}
                alt={document.original_filename}
                className="max-h-[70vh] w-full rounded border border-black/10 object-contain dark:border-white/15"
              />
            )
          ) : (
            <p className="text-sm text-red-600 dark:text-red-400">
              Could not load the document preview.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-black/60 dark:text-white/60">
            Extracted fields <span className="text-xs">({document.status})</span>
          </h2>

          {document.status === "failed" && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {document.error_message ?? "Processing failed."}
            </p>
          )}

          {UNPROCESSED_STATUSES.has(document.status) && (
            <p className="text-sm text-black/60 dark:text-white/60">
              Not processed yet — check back once this document leaves the queue.
            </p>
          )}

          {isProcessed && templateFields.length === 0 && (
            <p className="text-sm text-black/60 dark:text-white/60">
              This document&apos;s template has no fields defined.
            </p>
          )}

          {isProcessed && templateFields.length > 0 && (
            <ul className="flex flex-col gap-2">
              {templateFields.map((field) => {
                const extracted = fieldsByKey.get(field.key);
                const finalConfidence = extracted?.final_confidence ?? null;
                const flagged = finalConfidence !== null && needsAttention(finalConfidence);
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
                      {flagged && (
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          Needs attention
                        </span>
                      )}
                    </div>

                    <p className="text-sm">
                      {rawValue || (
                        <span className="text-black/40 dark:text-white/40">(not found)</span>
                      )}
                    </p>

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
          )}
        </div>
      </div>
    </main>
  );
}
