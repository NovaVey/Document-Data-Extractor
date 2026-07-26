"use client";

import { useRef } from "react";
import Link from "next/link";
import { DOCUMENT_STATUSES, statusLabel } from "@/lib/documents/status";

type Template = { id: string; name: string };

// Status/Template auto-submit on change (a plain GET form still — just
// triggered by JS instead of requiring an extra click on "Filter") since
// picking a value from a dropdown and having nothing visibly happen
// reads as broken. Filename stays manual-submit: auto-submitting on
// every keystroke would fight the reviewer while they're still typing.
export function FilterForm({
  status,
  template,
  q,
  templates,
  hasFilters,
}: {
  status?: string;
  template?: string;
  q?: string;
  templates: Template[];
  hasFilters: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} className="flex flex-wrap items-end gap-3" method="get">
      <label className="flex flex-col gap-1 text-sm">
        Status
        <select
          name="status"
          defaultValue={status ?? ""}
          onChange={() => formRef.current?.requestSubmit()}
          className="rounded border border-black/10 bg-white px-2 py-1 text-sm text-black dark:border-white/15"
        >
          <option value="" className="text-black">
            All
          </option>
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s} className="text-black">
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Template
        <select
          name="template"
          defaultValue={template ?? ""}
          onChange={() => formRef.current?.requestSubmit()}
          className="rounded border border-black/10 bg-white px-2 py-1 text-sm text-black dark:border-white/15"
        >
          <option value="" className="text-black">
            All
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id} className="text-black">
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Filename
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search filename"
          className="rounded border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15"
        />
      </label>

      <button
        type="submit"
        className="rounded border border-black/10 px-3 py-1.5 text-sm dark:border-white/15"
      >
        Filter
      </button>
      {hasFilters && (
        <Link href="/documents" className="py-1.5 text-sm underline underline-offset-2">
          Clear
        </Link>
      )}
    </form>
  );
}
