import type { ValidationStatus } from "../validation/types.js";

// The full per-field shape once extraction, validation, and scoring have
// all run — maps directly onto extracted_fields' columns.
export type ScoredField = {
  key: string;
  rawValue: string;
  normalizedValue: string | null;
  modelConfidence: number;
  validationStatus: ValidationStatus;
  validationNotes: string | null;
  finalConfidence: number;
};
