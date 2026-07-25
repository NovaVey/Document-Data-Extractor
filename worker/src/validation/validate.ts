import { isKnownDueTerm, parseCurrency, parseDate, parseNumber } from "./parse.js";
import type { FieldValidationResult, ValidationStatus } from "./types.js";
import type { ExtractedField, TemplateField } from "../extraction/types.js";

// The strongest signal available without extracting individual line items
// (out of scope for v1 — see the project's own scope notes): if a template
// happens to define fields with these exact keys, subtotal + tax is checked
// against total. This is opportunistic, not required — a template without
// these fields just skips the check, it isn't an error.
const ARITHMETIC_FIELD_KEYS = { subtotal: "subtotal", tax: "tax", total: "total" } as const;
const DATE_ORDER_FIELD_KEYS = { invoiceDate: "invoice_date", dueDate: "due_date" } as const;
const ARITHMETIC_TOLERANCE = 0.01;

export function validateFields(
  templateFields: TemplateField[],
  extracted: ExtractedField[],
): FieldValidationResult[] {
  const extractedByKey = new Map(extracted.map((field) => [field.key, field]));
  const results = new Map<string, FieldValidationResult>();

  for (const field of templateFields) {
    const rawValue = extractedByKey.get(field.key)?.rawValue ?? "";
    results.set(field.key, validateSingleField(field, rawValue));
  }

  applyArithmeticCheck(results);
  applyDateOrderCheck(results);

  return Array.from(results.values());
}

function validateSingleField(field: TemplateField, rawValue: string): FieldValidationResult {
  const trimmed = rawValue.trim();

  if (trimmed === "") {
    return {
      key: field.key,
      normalizedValue: null,
      validationStatus: field.required ? "missing" : "valid",
      validationNotes: field.required ? "Required field not found in document" : null,
    };
  }

  switch (field.type) {
    case "number": {
      const parsed = parseNumber(trimmed);
      return parsed === null
        ? invalid(field.key, `Could not parse "${rawValue}" as a number`)
        : valid(field.key, String(parsed));
    }
    case "currency": {
      const parsed = parseCurrency(trimmed);
      return parsed === null
        ? invalid(field.key, `Could not parse "${rawValue}" as a currency amount`)
        : valid(field.key, parsed.toFixed(2));
    }
    case "date": {
      const parsed = parseDate(trimmed);
      if (parsed) return valid(field.key, parsed);
      if (isKnownDueTerm(trimmed)) {
        return {
          key: field.key,
          normalizedValue: null,
          validationStatus: "valid",
          validationNotes: "Non-calendar due term, not a specific date",
        };
      }
      return invalid(field.key, `Could not parse "${rawValue}" as a date`);
    }
    case "text":
    default:
      return valid(field.key, trimmed);
  }
}

function valid(key: string, normalizedValue: string): FieldValidationResult {
  return { key, normalizedValue, validationStatus: "valid", validationNotes: null };
}

function invalid(key: string, note: string): FieldValidationResult {
  return { key, normalizedValue: null, validationStatus: "invalid", validationNotes: note };
}

function markInvalid(result: FieldValidationResult, note: string): void {
  result.validationStatus = "invalid";
  result.validationNotes = result.validationNotes ? `${result.validationNotes}; ${note}` : note;
}

function applyArithmeticCheck(results: Map<string, FieldValidationResult>): void {
  const subtotal = results.get(ARITHMETIC_FIELD_KEYS.subtotal);
  const tax = results.get(ARITHMETIC_FIELD_KEYS.tax);
  const total = results.get(ARITHMETIC_FIELD_KEYS.total);
  if (!subtotal || !tax || !total) return;
  if (
    subtotal.validationStatus !== "valid" ||
    tax.validationStatus !== "valid" ||
    total.validationStatus !== "valid"
  ) {
    return;
  }

  const subtotalNum = Number(subtotal.normalizedValue);
  const taxNum = Number(tax.normalizedValue);
  const totalNum = Number(total.normalizedValue);
  const expected = Math.round((subtotalNum + taxNum) * 100) / 100;
  const diff = Math.abs(expected - totalNum);

  if (diff > ARITHMETIC_TOLERANCE) {
    const note = `Arithmetic mismatch: subtotal (${subtotalNum.toFixed(2)}) + tax (${taxNum.toFixed(2)}) = ${expected.toFixed(2)}, but total is ${totalNum.toFixed(2)}`;
    markInvalid(subtotal, note);
    markInvalid(tax, note);
    markInvalid(total, note);
  }
}

function applyDateOrderCheck(results: Map<string, FieldValidationResult>): void {
  const invoiceDate = results.get(DATE_ORDER_FIELD_KEYS.invoiceDate);
  const dueDate = results.get(DATE_ORDER_FIELD_KEYS.dueDate);
  if (!invoiceDate || !dueDate) return;
  if (invoiceDate.validationStatus !== "valid" || dueDate.validationStatus !== "valid") return;
  if (!invoiceDate.normalizedValue || !dueDate.normalizedValue) return; // e.g. due_date is a known non-date term

  if (dueDate.normalizedValue < invoiceDate.normalizedValue) {
    markInvalid(
      dueDate,
      `Due date (${dueDate.normalizedValue}) is before invoice date (${invoiceDate.normalizedValue})`,
    );
  }
}

export type { ValidationStatus };
