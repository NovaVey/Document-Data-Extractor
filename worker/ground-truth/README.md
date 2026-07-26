# Ground-truth set

The acceptance harness for this project's accuracy claims. 10 synthetic
invoices across 3 fictional vendors (never a real company — see the
project's own rule about that), with every field's true value hand-recorded
in `ground-truth.json` exactly as it's printed on the document.

Deliberately not 10 easy documents: includes a skewed/noisy scan, a plain
scan, a missing optional field (no PO number), an unusual two-column
layout, and multiple date formats (ISO, US slash, written out, and one
field that's a phrase instead of a date — "Due on receipt"). Field-level
accuracy measured against only-clean documents wouldn't mean much.

## Files

- `documents/` — the 10 source files (7 PDFs, 3 PNGs)
- `ground-truth.json` — `{ documents: [{ id, vendor, file, mime_type, kind, fields }] }`,
  one entry per document. `fields.<key>` is `null` where a field is
  genuinely absent from the document (e.g. `riverbend-03.po_number`) —
  extraction should report the same absence, not guess.
- `generate.py` — regenerates everything from scratch (`pip install
  reportlab pillow`, then `python3 generate.py`). Source of truth for how
  these were built, not a one-off throwaway.

## Using it

Item 7+ (validators, confidence scoring, the review-threshold tuning) and
Phase 4's published accuracy numbers are measured by running extraction
against every document here and comparing the result to `ground-truth.json`
field by field.
