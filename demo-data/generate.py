"""Generates the 2 extra invoices that bring the demo dataset up to 12,
on top of the 10 already in worker/ground-truth/documents/. Kept separate
from the ground-truth generator on purpose: ground-truth is a fixed,
stable accuracy-measurement baseline (Phase 3/4's job), while this is the
portfolio-demo dataset (Phase 5) — reusing the same 10 files is safe and
efficient, but growing the *ground-truth* set itself just to pad out a
demo would conflate two different concerns.

Same 3 fictional vendors as the ground-truth set, for a consistent demo
narrative (never a real company, per this project's own rule about
documents containing other people's data even when fictional).

Usage (from this directory):
    pip install reportlab pillow
    python3 generate.py

Regenerates documents/*.pdf and manifest.json (this dir's own 2 files
only — the manifest also references the 10 ground-truth files by their
existing relative path, for the seed script to pick up in one place).
"""

import json
import os

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.join(SCRIPT_DIR, "documents")
GROUND_TRUTH_DIR = os.path.join(SCRIPT_DIR, "..", "worker", "ground-truth")
os.makedirs(DOCS_DIR, exist_ok=True)

VENDORS = {
    "cobalt": {"name": "Cobalt Ridge Electrical", "address": "1140 Vantage Rd, Suite B, Denver, CO 80202"},
    "marrowfinch": {"name": "Marrow & Finch Print Co.", "address": "76 Kestrel Lane, Austin, TX 78701"},
}

NEW_INVOICES = [
    {
        "id": "cobalt-04", "vendor": "cobalt",
        "invoice_number": "CRE-3201", "invoice_date": "2026-07-15", "due_date": "2026-08-14",
        "po_number": "WO-5730", "bill_to": "Aspen Grove Apartments, 640 Aspen Grove Ln, Denver, CO 80209",
        "line_items": [
            ("Rewiring labor (hrs)", 14, 95.00), ("Outlet, GFCI", 12, 18.50),
            ("Wiring, 12AWG (ft)", 150, 1.25),
        ],
        "tax_rate": 0.075,
    },
    {
        "id": "marrowfinch-04", "vendor": "marrowfinch",
        "invoice_number": "MF-2350", "invoice_date": "2026-07-20", "due_date": "2026-08-19",
        "po_number": "4601", "bill_to": "Thornwood Books, 12 Congress Ave, Austin, TX 78701",
        "line_items": [
            ("Postcards (x2000)", 2000, 0.10), ("Bookmarks (x1000)", 1000, 0.12),
            ("Design fee", 1, 90.00),
        ],
        "tax_rate": 0.0825,
    },
]


def money(x):
    return f"${x:,.2f}"


def compute_totals(inv):
    subtotal = sum(qty * price for _, qty, price in inv["line_items"])
    tax = round(subtotal * inv["tax_rate"], 2)
    total = round(subtotal + tax, 2)
    return round(subtotal, 2), tax, total


def render_digital_pdf(inv, vendor, subtotal, tax, total, path):
    c = canvas.Canvas(path, pagesize=letter)
    width, height = letter
    y = height - 72

    def line(text, size=11, gap=16, bold=False):
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(72, y, text)
        y -= gap

    line(vendor["name"], size=16, bold=True, gap=22)
    line(vendor["address"])
    line("")
    line("INVOICE", size=14, bold=True, gap=20)
    line(f"Invoice #: {inv['invoice_number']}")
    line(f"Invoice Date: {inv['invoice_date']}")
    line(f"Due Date: {inv['due_date']}")
    line(f"PO Number: {inv['po_number']}")
    line(f"Bill To: {inv['bill_to']}")
    line("")
    line("Description                              Qty     Unit Price     Line Total", bold=True)
    for desc, qty, price in inv["line_items"]:
        line_total = qty * price
        line(f"{desc:<40} {qty:>6}     {money(price):>10}     {money(line_total):>10}")
    line("")
    line(f"Subtotal:{'':>50}{money(subtotal):>12}")
    line(f"Tax ({inv['tax_rate']*100:.2f}%):{'':>45}{money(tax):>12}")
    line(f"Total Due:{'':>49}{money(total):>12}", bold=True)

    c.save()


def main():
    with open(os.path.join(GROUND_TRUTH_DIR, "ground-truth.json")) as f:
        ground_truth = json.load(f)["documents"]

    demo_docs = []
    for doc in ground_truth:
        demo_docs.append({
            "id": doc["id"],
            "vendor": doc["vendor"],
            "path": os.path.join("..", "worker", "ground-truth", "documents", doc["file"]),
            "mime_type": doc["mime_type"],
            "fields": doc["fields"],
            "source": "ground-truth",
        })

    for inv in NEW_INVOICES:
        vendor = VENDORS[inv["vendor"]]
        subtotal, tax, total = compute_totals(inv)
        filename = f"{inv['id']}.pdf"
        render_digital_pdf(inv, vendor, subtotal, tax, total, os.path.join(DOCS_DIR, filename))

        demo_docs.append({
            "id": inv["id"],
            "vendor": vendor["name"],
            "path": os.path.join("documents", filename),
            "mime_type": "application/pdf",
            "fields": {
                "vendor_name": vendor["name"],
                "invoice_number": inv["invoice_number"],
                "invoice_date": inv["invoice_date"],
                "due_date": inv["due_date"],
                "po_number": inv["po_number"],
                "subtotal": money(subtotal),
                "tax": money(tax),
                "total": money(total),
            },
            "source": "demo-only",
        })
        print(f"generated {filename}")

    with open(os.path.join(SCRIPT_DIR, "manifest.json"), "w") as f:
        json.dump({"documents": demo_docs}, f, indent=2)
    print(f"\nwrote manifest.json with {len(demo_docs)} documents "
          f"({len(ground_truth)} reused from ground-truth + {len(NEW_INVOICES)} new)")


if __name__ == "__main__":
    main()
