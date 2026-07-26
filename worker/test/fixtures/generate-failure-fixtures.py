#!/usr/bin/env python3
"""Regenerates the two failure-isolation fixtures for Phase 3 item 16
(worker/test/fixtures/corrupt-invoice.pdf, locked-invoice.pdf) — kept
reproducible rather than checked in as an opaque binary, same reasoning
as the ground-truth generator (worker/ground-truth/generate.py).

Run from worker/: python3 test/fixtures/generate-failure-fixtures.py
"""

import os

from reportlab.lib.pagesizes import letter
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfgen import canvas

FIXTURES_DIR = os.path.dirname(__file__)

# Not a real PDF at all — a PDF-looking header followed by garbage,
# simulating a genuinely corrupt upload (partial download, bit rot, the
# wrong file renamed to .pdf).
with open(os.path.join(FIXTURES_DIR, "corrupt-invoice.pdf"), "wb") as f:
    f.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\ncorrupted garbage, not a real PDF body\x00\x01\x02")

# A real, validly-structured PDF that requires a password to open —
# simulates a locked/protected file a user might upload by mistake.
encryption = StandardEncryption("secret-password", canPrint=1)
locked_path = os.path.join(FIXTURES_DIR, "locked-invoice.pdf")
c = canvas.Canvas(locked_path, pagesize=letter, encrypt=encryption)
c.drawString(72, 720, "This PDF is password-protected.")
c.save()

print("Generated corrupt-invoice.pdf and locked-invoice.pdf")
