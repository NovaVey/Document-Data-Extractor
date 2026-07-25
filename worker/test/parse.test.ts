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
