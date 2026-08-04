"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { DOCUMENT_STATUSES, statusLabel } from "@/lib/documents/status";

type Template = { id: string; name: string };

const AUTO_SUBMIT_DEBOUNCE_MS = 400;

// Status/Template auto-submit on change (a plain GET form still — just
// triggered by JS instead of requiring an extra click on "Filter") since
// picking a value from a dropdown and having nothing visibly happen
// reads as broken. Debounced rather than submitting on the raw change
// event: a keyboard user arrowing through a *closed* native <select>
// fires one change event per keypress (only a mouse click, or opening
// the dropdown with the keyboard and pressing Enter, produces a single
// change) — undebounced, every arrow press would trigger a full page
// navigation mid-selection, interrupting the act of choosing a value
// entirely (a WCAG 3.2.2 "On Input" violation). Debouncing means only
// the value the user actually settles on gets submitted, while a mouse
// click still applies the filter almost immediately. Filename stays
// fully manual-submit (no debounce or auto-submit at all): auto-
// submitting on every keystroke would fight the reviewer while they're
// still typing, debounced or not.
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function scheduleAutoSubmit() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      formRef.current?.requestSubmit();
    }, AUTO_SUBMIT_DEBOUNCE_MS);
  }

  return (
    <form ref={formRef} className="flex flex-wrap items-end gap-3" method="get">
      <label className="flex flex-col gap-1 text-sm">
        Status
        <select
          name="status"
          defaultValue={status ?? ""}
          onChange={scheduleAutoSubmit}
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
          onChange={scheduleAutoSubmit}
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
