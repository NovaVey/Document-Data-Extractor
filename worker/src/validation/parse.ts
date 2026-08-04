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

// Standard 3-letter abbreviations, same index as MONTH_NAMES (May has none
// distinct from its full name, both 3 letters). "Sept" is a common 4-letter
// variant but not standard — not worth the ambiguity it'd add.
const MONTH_ABBREVIATIONS = MONTH_NAMES.map((name) => name.slice(0, 3));

function monthIndexFromName(name: string): number {
  const lower = name.toLowerCase();
  const fullIndex = MONTH_NAMES.indexOf(lower);
  if (fullIndex !== -1) return fullIndex;
  return MONTH_ABBREVIATIONS.indexOf(lower);
}

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

// A bare comma is ambiguous: "1,320" is US thousands-separator notation
// (-> 1320), but "50,00" is European decimal-comma notation (-> 50.00). A
// blanket "strip every comma" treats both as thousands separators, silently
// turning 50,00 into 5000 — a 100x error that passes straight through
// validation with the model's own high confidence. Disambiguate the same
// way real-world parsers do: a comma is only a decimal separator when
// there's no period already in the string AND it's followed by exactly 1-2
// trailing digits (cents/units are always 1-2 digits; a thousands group is
// always exactly 3). Anything else — including "1,320" (3 digits after the
// comma) and any string that already has a period — keeps the original
// strip-as-thousands-separator behavior.
function normalizeSeparators(raw: string): string {
  if (!raw.includes(".") && /,\d{1,2}$/.test(raw)) {
    return raw.replace(",", ".");
  }
  return raw.replace(/,/g, "");
}

export function parseNumber(raw: string): number | null {
  const cleaned = normalizeSeparators(raw.trim());
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Handles a leading currency symbol, thousands/decimal separators (see
// normalizeSeparators above), and accounting-style parenthesized negatives
// ("($50.00)" means -50.00) — common enough on real invoices (credits,
// adjustments) to be worth the small extra code.
export function parseCurrency(raw: string): number | null {
  let cleaned = raw.trim();
  if (cleaned === "") return null;

  let negative = false;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }

  cleaned = normalizeSeparators(cleaned.replace(/\$/g, "").trim());
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

  const writtenMatch = trimmed.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (writtenMatch) {
    const [, monthName, d, y] = writtenMatch;
    const monthIndex = monthIndexFromName(monthName);
    if (monthIndex === -1) return null;
    const m = monthIndex + 1;
    if (!isValidCalendarDate(+y, m, +d)) return null;
    return `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}
