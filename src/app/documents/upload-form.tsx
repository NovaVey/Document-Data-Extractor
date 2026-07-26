"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createDocumentRecord,
  deleteDocumentForReplace,
  findDuplicateDocument,
  type DuplicateDocument,
} from "./actions";

// Mirrors the storage bucket's own allowed_mime_types/file_size_limit
// (supabase/migrations/20260725020000_upload_storage.sql) — that bucket
// config is the authoritative check (can't be bypassed by a crafted
// client), this is just fast feedback before bytes go over the wire.
const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

type FileResult = {
  name: string;
  status: "checking" | "pending" | "uploading" | "success" | "error" | "skipped" | "duplicate";
  message?: string;
  duplicateOf?: DuplicateDocument;
  // Hidden rather than spliced out — indices here have to stay aligned
  // with entriesRef.current, which handleReplace() reads by the same
  // index for any row rendered after this one.
  dismissed?: boolean;
};

type FileEntry = { file: File; hash: string };

type Template = { id: string; name: string };

export function UploadForm({ orgId, templates }: { orgId: string; templates: Template[] }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [results, setResults] = useState<FileResult[]>([]);
  const [uploading, setUploading] = useState(false);
  // Per-index {file, hash}, populated once during the duplicate-check
  // pass and read later by the Skip/Replace buttons — a ref rather than
  // state since it's an input to later actions, not something rendered.
  const entriesRef = useRef<FileEntry[]>([]);

  async function uploadEntry(index: number, entry: FileEntry) {
    setResults((prev) => setResult(prev, index, { status: "uploading" }));

    const supabase = createClient();
    try {
      const storagePath = `${orgId}/${crypto.randomUUID()}-${sanitizeFilename(entry.file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, entry.file, { contentType: entry.file.type });
      if (uploadError) throw new Error(uploadError.message);

      const result = await createDocumentRecord({
        originalFilename: entry.file.name,
        storagePath,
        fileHash: entry.hash,
        mimeType: entry.file.type,
        templateId,
      });
      if (result?.error) throw new Error(result.error);

      setResults((prev) => setResult(prev, index, { status: "success", message: undefined }));
    } catch (err) {
      setResults((prev) =>
        setResult(prev, index, {
          status: "error",
          message: err instanceof Error ? err.message : "Upload failed",
        }),
      );
    }
  }

  async function handleFiles(fileList: FileList) {
    const files = Array.from(fileList);
    setUploading(true);
    setResults(files.map((file) => ({ name: file.name, status: "checking" })));

    const seenHashes: string[] = [];
    const entries: FileEntry[] = [];
    const statuses: FileResult["status"][] = [];

    function update(i: number, patch: Partial<FileResult>) {
      statuses[i] = patch.status ?? statuses[i];
      setResults((prev) => setResult(prev, i, patch));
    }

    // Phase 1: validate and hash every file, checking for duplicates both
    // within this batch (client-side, no round trip) and against what's
    // already in this org (via the server) — before uploading anything,
    // so a duplicate never wastes a Storage upload only to be rejected by
    // the (org_id, file_hash) unique index afterward.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        entries.push({ file, hash: "" });
        update(i, { status: "error", message: `Unsupported file type: ${file.type || "unknown"}` });
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        entries.push({ file, hash: "" });
        update(i, { status: "error", message: "File exceeds the 20MB limit" });
        continue;
      }

      const hash = await sha256Hex(file);
      entries.push({ file, hash });

      const sameBatchIndex = seenHashes.indexOf(hash);
      seenHashes.push(hash);
      if (sameBatchIndex !== -1) {
        update(i, {
          status: "skipped",
          message: `Duplicate of "${files[sameBatchIndex].name}" earlier in this batch`,
        });
        continue;
      }

      const duplicate = await findDuplicateDocument(hash);
      if (duplicate) {
        update(i, { status: "duplicate", duplicateOf: duplicate });
        continue;
      }

      update(i, { status: "pending" });
    }

    entriesRef.current = entries;

    // Phase 2: upload everything still pending. Files awaiting a
    // Skip/Replace decision (status "duplicate") are deliberately left
    // alone here — they're resolved by the buttons below, not this loop.
    for (let i = 0; i < entries.length; i++) {
      if (statuses[i] !== "pending") continue;
      await uploadEntry(i, entries[i]);
    }

    setUploading(false);
    router.refresh();
  }

  function handleSkip(index: number) {
    setResults((prev) =>
      setResult(prev, index, { status: "skipped", message: "Skipped", duplicateOf: undefined }),
    );
  }

  // Dismisses a row from view only — it doesn't cancel an in-flight
  // upload (there's no AbortController wiring for that), just hides
  // finished/errored/duplicate-pending entries the reviewer is done with.
  // Marks rather than removes so entriesRef.current's indices (read by
  // handleReplace() for any row still on screen) never shift.
  function handleRemove(index: number) {
    setResults((prev) => setResult(prev, index, { dismissed: true }));
  }

  async function handleReplace(index: number, existingDocumentId: string) {
    setResults((prev) => setResult(prev, index, { status: "uploading", message: "Replacing…" }));
    try {
      const result = await deleteDocumentForReplace(existingDocumentId);
      if (result?.error) throw new Error(result.error);
      await uploadEntry(index, entriesRef.current[index]);
      router.refresh();
    } catch (err) {
      setResults((prev) =>
        setResult(prev, index, {
          status: "error",
          message: err instanceof Error ? err.message : "Failed to replace",
        }),
      );
    }
  }

  if (templates.length === 0) {
    return (
      <p className="text-sm text-black/60 dark:text-white/60">
        No templates yet —{" "}
        <a href="/templates/new" className="underline underline-offset-2">
          create one
        </a>{" "}
        before uploading documents.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-col gap-1">
        <label htmlFor="template-select" className="text-sm font-medium">
          Template
        </label>
        <select
          id="template-select"
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
          disabled={uploading}
          className="rounded border border-black/15 bg-white px-2 py-1 text-sm text-black dark:border-white/20"
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id} className="text-black">
              {template.name}
            </option>
          ))}
        </select>
      </div>
      {/* Plain text, not a <label htmlFor>, so only the "Choose files"
          button below opens the file picker — clicking this description
          shouldn't. */}
      <p className="text-sm font-medium">Upload documents (PDF, PNG, or JPEG — up to 20MB each)</p>
      <label
        htmlFor="file-upload"
        className={`w-fit rounded px-4 py-2 text-sm font-medium text-background ${
          uploading ? "cursor-not-allowed bg-foreground/50" : "cursor-pointer bg-foreground"
        }`}
      >
        Choose files
      </label>
      <input
        id="file-upload"
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg"
        disabled={uploading}
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) {
            handleFiles(event.target.files);
          }
          event.target.value = "";
        }}
        className="sr-only"
      />
      {results.some((result) => !result.dismissed) && (
        <ul className="flex flex-col gap-1 text-sm">
          {results.map((result, idx) => {
            if (result.dismissed) return null;
            return (
              <li key={idx} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="truncate">{result.name}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className={
                        result.status === "error"
                          ? "text-red-600 dark:text-red-400"
                          : result.status === "success"
                            ? "text-green-600 dark:text-green-400"
                            : result.status === "duplicate"
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-black/60 dark:text-white/60"
                      }
                    >
                      {result.status === "checking"
                        ? "Checking…"
                        : result.status === "pending"
                          ? "Queued…"
                          : result.status === "uploading"
                            ? (result.message ?? "Uploading…")
                            : (result.message ?? result.status)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemove(idx)}
                      aria-label={`Remove ${result.name} from this list`}
                      title="Remove from list"
                      className="text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
                    >
                      ×
                    </button>
                  </span>
                </div>
                {result.status === "duplicate" && result.duplicateOf && (
                  <div className="flex flex-wrap items-center gap-2 rounded bg-amber-50 px-2 py-1 text-xs dark:bg-amber-950/20">
                    <span className="text-black/70 dark:text-white/70">
                      Duplicate of &quot;{result.duplicateOf.originalFilename}&quot; (
                      {result.duplicateOf.status}, uploaded{" "}
                      {new Date(result.duplicateOf.uploadedAt).toLocaleDateString()})
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSkip(idx)}
                      className="rounded border border-black/10 px-2 py-0.5 dark:border-white/15"
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReplace(idx, result.duplicateOf!.id)}
                      className="rounded border border-black/10 px-2 py-0.5 dark:border-white/15"
                    >
                      Replace existing
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function setResult(prev: FileResult[], index: number, patch: Partial<FileResult>): FileResult[] {
  const next = [...prev];
  next[index] = { ...next[index], ...patch };
  return next;
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}
