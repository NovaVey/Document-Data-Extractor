"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createDocumentRecord, documentExistsForHash } from "./actions";

// Mirrors the storage bucket's own allowed_mime_types/file_size_limit
// (supabase/migrations/20260725020000_upload_storage.sql) — that bucket
// config is the authoritative check (can't be bypassed by a crafted
// client), this is just fast feedback before bytes go over the wire.
const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

type FileResult = {
  name: string;
  status: "pending" | "success" | "error" | "skipped";
  message?: string;
};

type Template = { id: string; name: string };

export function UploadForm({ orgId, templates }: { orgId: string; templates: Template[] }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [results, setResults] = useState<FileResult[]>([]);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(fileList: FileList) {
    const files = Array.from(fileList);
    setUploading(true);
    setResults(files.map((file) => ({ name: file.name, status: "pending" })));

    const supabase = createClient();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
          throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
        }
        if (file.size > MAX_FILE_SIZE) {
          throw new Error("File exceeds the 20MB limit");
        }

        const fileHash = await sha256Hex(file);

        if (await documentExistsForHash(fileHash)) {
          setResults((prev) =>
            setResult(prev, i, { status: "skipped", message: "Already uploaded" }),
          );
          continue;
        }

        const storagePath = `${orgId}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(storagePath, file, { contentType: file.type });
        if (uploadError) throw new Error(uploadError.message);

        await createDocumentRecord({
          originalFilename: file.name,
          storagePath,
          fileHash,
          mimeType: file.type,
          templateId,
        });

        setResults((prev) => setResult(prev, i, { status: "success" }));
      } catch (err) {
        setResults((prev) =>
          setResult(prev, i, {
            status: "error",
            message: err instanceof Error ? err.message : "Upload failed",
          }),
        );
      }
    }

    setUploading(false);
    router.refresh();
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
          className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </div>
      <label htmlFor="file-upload" className="text-sm font-medium">
        Upload documents (PDF, PNG, or JPEG — up to 20MB each)
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
      />
      {results.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {results.map((result, idx) => (
            <li key={idx} className="flex items-center justify-between gap-4">
              <span className="truncate">{result.name}</span>
              <span
                className={
                  result.status === "error"
                    ? "text-red-600 dark:text-red-400"
                    : result.status === "success"
                      ? "text-green-600 dark:text-green-400"
                      : "text-black/60 dark:text-white/60"
                }
              >
                {result.status === "pending" ? "Uploading…" : (result.message ?? result.status)}
              </span>
            </li>
          ))}
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
