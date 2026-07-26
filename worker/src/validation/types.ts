export type ValidationStatus = "valid" | "invalid" | "missing";

export type FieldValidationResult = {
  key: string;
  normalizedValue: string | null;
  validationStatus: ValidationStatus;
  validationNotes: string | null;
};
