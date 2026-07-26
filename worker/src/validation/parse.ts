const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// Common invoice due-terms that are legitimate values for a "date" field
// without being a calendar date at all. Discovered by building the
// ground-truth set (item 6) — a real invoice can print "Due on receipt"
// instead of a date, and that's not a parsing failure, it's the answer.
const NON_DATE_DUE_TERMS = [
  "due on receipt",
  "upon receipt",
  "cash on delivery",
  "cod",
  "net 15",
  "net 30",
  "net 45",
  "net 60",
  "net 90",
];

export function isKnownDueTerm(raw: string): boolean {
  return NON_DATE_DUE_TERMS.includes(raw.trim().toLowerCase());
}

export function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Handles a leading currency symbol, thousands separators, and accounting-
// style parenthesized negatives ("($50.00)" means -50.00) — common enough
// on real invoices (credits, adjustments) to be worth the small extra code.
export function parseCurrency(raw: string): number | null {
  let cleaned = raw.trim();
  if (cleaned === "") return null;

  let negative = false;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }

  cleaned = cleaned.replace(/[$,]/g, "").trim();
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

// Handles the three formats that actually show up on real invoices (and
// the ground-truth set, item 6): ISO (2026-06-14), US slash
// (06/28/2026), and written out ("July 5, 2026"). Returns ISO 8601 on
// success — this is the one place a date's format gets decided, instead
// of every downstream reader having to guess.
export function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return isValidCalendarDate(+y, +m, +d) ? trimmed : null;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    if (!isValidCalendarDate(+y, +m, +d)) return null;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const writtenMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (writtenMatch) {
    const [, monthName, d, y] = writtenMatch;
    const monthIndex = MONTH_NAMES.indexOf(monthName.toLowerCase());
    if (monthIndex === -1) return null;
    const m = monthIndex + 1;
    if (!isValidCalendarDate(+y, m, +d)) return null;
    return `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}
