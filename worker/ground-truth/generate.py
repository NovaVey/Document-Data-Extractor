"""Regenerates the ground-truth set: 10 synthetic invoices across 3 fictional
vendors, plus ground-truth.json recording every field's true value exactly
as printed. This is the acceptance harness items 7-9 (validators, confidence
scoring, review threshold) and Phase 4's accuracy numbers are measured
against — never a real company, per this project's own rule that documents
contain other people's data even when fictional.

Deliberately includes messy, realistic cases, not just clean ones: a
skewed/noisy scan (riverbend-02, cobalt-02), a plain scan (marrowfinch-02),
a missing optional field (riverbend-03 has no PO number), an unusual
two-column layout (cobalt-03), varied date formats (ISO, US slash, written
out, and one non-date value: "Due on receipt"). An accuracy harness made of
only easy documents wouldn't measure anything.

Usage (from this directory):
    pip install reportlab pillow
    python3 generate.py

Regenerates documents/*.pdf, documents/*.png, and ground-truth.json.
"""

import json
import os
import random

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw, ImageFont

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.join(SCRIPT_DIR, "documents")
os.makedirs(DOCS_DIR, exist_ok=True)

FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

VENDORS = {
    "riverbend": {"name": "Riverbend Supply Co.", "address": "482 Cascade Ave, Portland, OR 97209"},
    "cobalt": {"name": "Cobalt Ridge Electrical", "address": "1140 Vantage Rd, Suite B, Denver, CO 80202"},
    "marrowfinch": {"name": "Marrow & Finch Print Co.", "address": "76 Kestrel Lane, Austin, TX 78701"},
}

INVOICES = [
    {
        "id": "riverbend-01", "vendor": "riverbend", "kind": "digital", "layout": "standard",
        "invoice_number": "INV-10492", "invoice_date": "2026-06-14", "due_date": "2026-07-14",
        "po_number": "PO-88213", "bill_to": "Maple & Co. Bakery, 119 Elm St, Salem, OR 97301",
        "line_items": [
            ("Flour, 50lb bag", 12, 18.50), ("Sugar, 25lb bag", 6, 22.00),
            ("Butter, case of 24", 3, 86.00), ("Delivery fee", 1, 35.00),
        ],
        "tax_rate": 0.08,
    },
    {
        "id": "riverbend-02", "vendor": "riverbend", "kind": "scanned_skewed", "layout": "standard",
        "invoice_number": "INV-10559", "invoice_date": "2026-06-20", "due_date": "2026-07-20",
        "po_number": "PO-88240", "bill_to": "Sunridge Diner, 88 Harbor Way, Astoria, OR 97103",
        "line_items": [
            ("Cooking Oil, 5gal jug", 8, 24.00), ("Rice, 25lb bag", 10, 19.75),
            ("Canned Tomatoes, case", 5, 28.00),
        ],
        "tax_rate": 0.08,
    },
    {
        "id": "riverbend-03", "vendor": "riverbend", "kind": "digital", "layout": "standard",
        "invoice_number": "INV-10601", "invoice_date": "06/28/2026", "due_date": "07/28/2026",
        "po_number": None, "bill_to": "Harbor View Cafe, 22 Dockside St, Astoria, OR 97103",
        "line_items": [
            ("Espresso Beans, 5lb bag", 6, 32.00), ("Milk, case", 4, 45.00),
        ],
        "tax_rate": 0.08,
    },
    {
        "id": "riverbend-04", "vendor": "riverbend", "kind": "digital", "layout": "standard",
        "invoice_number": "INV-10650", "invoice_date": "July 5, 2026", "due_date": "August 4, 2026",
        "po_number": "PO-88301", "bill_to": "Green Table Bistro, 501 Fremont Ave, Eugene, OR 97401",
        "line_items": [
            ("Olive Oil, 3L tin", 4, 65.00), ("Pasta, case", 10, 21.00),
            ("Parmesan wheel", 2, 95.00),
        ],
        "tax_rate": 0.08,
    },
    {
        "id": "cobalt-01", "vendor": "cobalt", "kind": "digital", "layout": "standard",
        "invoice_number": "CRE-3021", "invoice_date": "2026-06-10", "due_date": "2026-07-10",
        "po_number": "WO-5521", "bill_to": "Union Street Apartments, 300 Union St, Denver, CO 80203",
        "line_items": [
            ("Panel upgrade labor (hrs)", 8, 95.00), ("Breaker box, 200A", 1, 310.00),
            ("Wiring, 12AWG (ft)", 200, 1.25),
        ],
        "tax_rate": 0.075,
    },
    {
        "id": "cobalt-02", "vendor": "cobalt", "kind": "scanned_skewed", "layout": "standard",
        "invoice_number": "CRE-3095", "invoice_date": "2026-06-25", "due_date": "2026-07-25",
        "po_number": "WO-5602", "bill_to": "Pinehurst Office Park, 900 Pinehurst Dr, Denver, CO 80204",
        "line_items": [
            ("Emergency service call (hrs)", 2, 140.00), ("Circuit breaker, 20A", 3, 45.00),
            ("Diagnostic fee", 1, 85.00),
        ],
        "tax_rate": 0.075,
    },
    {
        "id": "cobalt-03", "vendor": "cobalt", "kind": "digital", "layout": "two_column",
        "invoice_number": "CRE-3140", "invoice_date": "2026-07-02", "due_date": "2026-08-01",
        "po_number": "WO-5677", "bill_to": "Lakeside Medical Building, 14 Shoreline Ct, Denver, CO 80202",
        "line_items": [
            ("Generator install labor (hrs)", 12, 110.00), ("Transfer switch", 1, 620.00),
            ("Permit fee", 1, 150.00),
        ],
        "tax_rate": 0.075,
    },
    {
        "id": "marrowfinch-01", "vendor": "marrowfinch", "kind": "digital", "layout": "standard",
        "invoice_number": "MF-2209", "invoice_date": "2026-06-18", "due_date": "2026-07-18",
        "po_number": "4471", "bill_to": "Bramwell & Associates, 210 Congress Ave, Austin, TX 78701",
        "line_items": [
            ("Business cards (x2000)", 2000, 0.08), ("Letterhead (x500)", 500, 0.35),
            ("Design fee", 1, 120.00),
        ],
        "tax_rate": 0.0825,
    },
    {
        "id": "marrowfinch-02", "vendor": "marrowfinch", "kind": "scanned", "layout": "standard",
        "invoice_number": "MF-2255", "invoice_date": "2026-06-30", "due_date": "2026-07-30",
        "po_number": "4498", "bill_to": "Cedarview Realty, 5100 Barton Springs Rd, Austin, TX 78704",
        "line_items": [
            ("Brochures (x1000)", 1000, 0.42), ("Yard signs", 25, 14.00),
        ],
        "tax_rate": 0.0825,
    },
    {
        "id": "marrowfinch-03", "vendor": "marrowfinch", "kind": "digital", "layout": "standard",
        "invoice_number": "MF-2301", "invoice_date": "2026-07-08", "due_date": "Due on receipt",
        "po_number": "4550", "bill_to": "Thistle & Vine Florals, 88 Barton Ave, Austin, TX 78704",
        "line_items": [
            ("Banners, 3x6ft", 3, 85.00), ("Vinyl decals (x40)", 40, 6.50),
        ],
        "tax_rate": 0.0825,
    },
]


def wrap_text(text, width):
    words = text.split(" ")
    lines, current = [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


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

    def line(text, size=11, gap=16, bold=False, x=72):
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(x, y, text)
        y -= gap

    if inv["layout"] == "two_column":
        line(vendor["name"], size=16, bold=True, gap=22)
        line(vendor["address"])
        y -= 6
        line("INVOICE", size=14, bold=True, gap=20)

        col_top = y
        c.setFont("Helvetica", 11)
        c.drawString(360, y, f"Invoice #: {inv['invoice_number']}")
        y -= 16
        c.drawString(360, y, f"Date: {inv['invoice_date']}")
        y -= 16
        c.drawString(360, y, f"Due: {inv['due_date']}")
        y -= 16
        if inv["po_number"]:
            c.drawString(360, y, f"PO #: {inv['po_number']}")
        y -= 16

        left_y = col_top
        c.setFont("Helvetica", 11)
        c.drawString(72, left_y, "Bill To:")
        left_y -= 16
        for wrapped in wrap_text(inv["bill_to"], 42):
            c.drawString(72, left_y, wrapped)
            left_y -= 16

        y = min(y, left_y) - 12
    else:
        line(vendor["name"], size=16, bold=True, gap=22)
        line(vendor["address"])
        line("")
        line("INVOICE", size=14, bold=True, gap=20)
        line(f"Invoice #: {inv['invoice_number']}")
        line(f"Invoice Date: {inv['invoice_date']}")
        line(f"Due Date: {inv['due_date']}")
        if inv["po_number"]:
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


def render_scanned_image(inv, vendor, subtotal, tax, total, skew):
    W, H = 1275, 1650
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)
    font_regular = ImageFont.truetype(FONT_REGULAR, 22)
    font_bold = ImageFont.truetype(FONT_BOLD, 26)

    lines = [(vendor["name"], font_bold), (vendor["address"], font_regular), ("", font_regular)]
    lines.append(("INVOICE", font_bold))
    lines.append((f"Invoice #: {inv['invoice_number']}", font_regular))
    lines.append((f"Invoice Date: {inv['invoice_date']}", font_regular))
    lines.append((f"Due Date: {inv['due_date']}", font_regular))
    if inv["po_number"]:
        lines.append((f"PO Number: {inv['po_number']}", font_regular))
    lines.append((f"Bill To: {inv['bill_to']}", font_regular))
    lines.append(("", font_regular))
    lines.append(("Description                    Qty   Unit Price   Line Total", font_bold))
    for desc, qty, price in inv["line_items"]:
        line_total = qty * price
        lines.append((f"{desc:<30} {qty:>5} {money(price):>10} {money(line_total):>12}", font_regular))
    lines.append(("", font_regular))
    lines.append((f"Subtotal:{'':>30}{money(subtotal):>12}", font_regular))
    lines.append((f"Tax ({inv['tax_rate']*100:.2f}%):{'':>25}{money(tax):>12}", font_regular))
    lines.append((f"Total Due:{'':>29}{money(total):>12}", font_bold))

    y = 100
    for text, font in lines:
        draw.text((100, y), text, fill="black", font=font)
        y += 40

    pixels = img.load()
    for _ in range(40000):
        x = random.randint(0, W - 1)
        yy = random.randint(0, H - 1)
        r, g, b = pixels[x, yy]
        noise = random.randint(-15, 15)
        pixels[x, yy] = (
            max(0, min(255, r + noise)),
            max(0, min(255, g + noise)),
            max(0, min(255, b + noise)),
        )

    if skew:
        img = img.rotate(-2.5, expand=True, fillcolor="white", resample=Image.BICUBIC)

    return img


def main():
    fixtures = []
    for inv in INVOICES:
        vendor = VENDORS[inv["vendor"]]
        subtotal, tax, total = compute_totals(inv)

        fields = {
            "vendor_name": vendor["name"],
            "invoice_number": inv["invoice_number"],
            "invoice_date": inv["invoice_date"],
            "due_date": inv["due_date"],
            "po_number": inv["po_number"],
            "subtotal": money(subtotal),
            "tax": money(tax),
            "total": money(total),
        }

        if inv["kind"] == "digital":
            filename = f"{inv['id']}.pdf"
            render_digital_pdf(inv, vendor, subtotal, tax, total, os.path.join(DOCS_DIR, filename))
            mime_type = "application/pdf"
        else:
            filename = f"{inv['id']}.png"
            skew = inv["kind"] == "scanned_skewed"
            img = render_scanned_image(inv, vendor, subtotal, tax, total, skew)
            img.save(os.path.join(DOCS_DIR, filename))
            mime_type = "image/png"

        fixtures.append({
            "id": inv["id"],
            "vendor": vendor["name"],
            "file": filename,
            "mime_type": mime_type,
            "kind": inv["kind"],
            "fields": fields,
        })
        print(f"generated {filename} ({inv['kind']})")

    with open(os.path.join(SCRIPT_DIR, "ground-truth.json"), "w") as f:
        json.dump({"documents": fixtures}, f, indent=2)
    print(f"\nwrote ground-truth.json with {len(fixtures)} documents")


if __name__ == "__main__":
    main()
