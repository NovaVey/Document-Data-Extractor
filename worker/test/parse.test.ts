import { describe, expect, it } from "vitest";
import { isKnownDueTerm, parseCurrency, parseDate, parseNumber } from "../src/validation/parse.js";

describe("parseNumber", () => {
  it("parses a plain integer", () => {
    expect(parseNumber("12")).toBe(12);
  });

  it("parses a decimal", () => {
    expect(parseNumber("18.5")).toBe(18.5);
  });

  it("strips thousands separators", () => {
    expect(parseNumber("1,320")).toBe(1320);
  });

  it("returns null for empty input", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("   ")).toBeNull();
  });

  it("returns null for non-numeric text", () => {
    expect(parseNumber("twelve")).toBeNull();
    expect(parseNumber("N/A")).toBeNull();
  });

  // Regression: a blanket comma-strip used to turn "50,00" (European
  // decimal-comma notation) into 5000 — a 100x error that would pass
  // validation with the model's own high confidence and sail past review.
  it("treats a comma followed by 1-2 trailing digits as a decimal separator, not a thousands separator", () => {
    expect(parseNumber("50,00")).toBe(50);
    expect(parseNumber("50,5")).toBe(50.5);
  });

  it("still treats a comma followed by exactly 3 digits as a thousands separator", () => {
    expect(parseNumber("1,320")).toBe(1320);
    expect(parseNumber("12,000")).toBe(12000);
  });
});

describe("parseCurrency", () => {
  it("parses a plain amount with a dollar sign", () => {
    expect(parseCurrency("$647.00")).toBe(647.0);
  });

  it("strips thousands separators", () => {
    expect(parseCurrency("$1,320.00")).toBe(1320.0);
  });

  it("parses an amount with no symbol", () => {
    expect(parseCurrency("51.76")).toBe(51.76);
  });

  it("treats parenthesized amounts as negative (accounting notation)", () => {
    expect(parseCurrency("($50.00)")).toBe(-50.0);
  });

  it("returns null for empty input", () => {
    expect(parseCurrency("")).toBeNull();
  });

  it("returns null for unparseable text", () => {
    expect(parseCurrency("see attached")).toBeNull();
  });

  // Same regression as parseNumber above, through the currency path
  // (leading $ and the parenthesized-negative case both still need to work
  // alongside the comma/decimal disambiguation).
  it("treats a comma followed by 1-2 trailing digits as a decimal separator", () => {
    expect(parseCurrency("$50,00")).toBe(50);
    expect(parseCurrency("50,00")).toBe(50);
  });

  it("still treats a comma followed by exactly 3 digits as a thousands separator", () => {
    expect(parseCurrency("$1,320")).toBe(1320);
  });

  it("disambiguates correctly even for a negative decimal-comma amount", () => {
    expect(parseCurrency("($50,00)")).toBe(-50);
  });
});

describe("parseDate", () => {
  it("parses ISO format", () => {
    expect(parseDate("2026-06-14")).toBe("2026-06-14");
  });

  it("parses US slash format (MM/DD/YYYY) to ISO", () => {
    expect(parseDate("06/28/2026")).toBe("2026-06-28");
  });

  it("parses US slash format with single-digit month/day", () => {
    expect(parseDate("7/5/2026")).toBe("2026-07-05");
  });

  it("parses written-out format to ISO", () => {
    expect(parseDate("July 5, 2026")).toBe("2026-07-05");
  });

  it("parses written-out format without a comma", () => {
    expect(parseDate("July 5 2026")).toBe("2026-07-05");
  });

  it("rejects an invalid month", () => {
    expect(parseDate("2026-13-01")).toBeNull();
  });

  it("rejects an invalid day for the given month", () => {
    expect(parseDate("2026-02-30")).toBeNull();
  });

  it("rejects a year far outside a plausible range", () => {
    expect(parseDate("1899-01-01")).toBeNull();
  });

  it("rejects an unrecognized month name", () => {
    expect(parseDate("Frobtober 5, 2026")).toBeNull();
  });

  // Regression: MONTH_NAMES only held full names, so a standard 3-letter
  // abbreviation ("Jan 5, 2026") was rejected outright rather than parsed.
  it("parses an abbreviated month name", () => {
    expect(parseDate("Jan 5, 2026")).toBe("2026-01-05");
    expect(parseDate("Sep 30, 2026")).toBe("2026-09-30");
  });

  it("parses an abbreviated month name with a trailing period", () => {
    expect(parseDate("Jan. 5, 2026")).toBe("2026-01-05");
  });

  it("still rejects a garbled near-miss abbreviation", () => {
    expect(parseDate("Jax 5, 2026")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for a non-date phrase", () => {
    expect(parseDate("Due on receipt")).toBeNull();
  });
});

describe("isKnownDueTerm", () => {
  it("recognizes common invoice due-terms case-insensitively", () => {
    expect(isKnownDueTerm("Due on receipt")).toBe(true);
    expect(isKnownDueTerm("NET 30")).toBe(true);
    expect(isKnownDueTerm("cash on delivery")).toBe(true);
  });

  it("does not recognize an actual date", () => {
    expect(isKnownDueTerm("2026-06-14")).toBe(false);
  });

  it("does not recognize arbitrary text", () => {
    expect(isKnownDueTerm("please pay promptly")).toBe(false);
  });
});
