import type { ExtractedField } from "../extraction/types.js";
import type { FieldValidationResult, ValidationStatus } from "../validation/types.js";
import type { ScoredField } from "./types.js";

// "Where they disagree, trust the validator" — a hard override, not a blend.
// A soft weighted average would still let a confident-but-wrong model pull
// the score up; a failed deterministic check is ground truth, so anything
// other than "valid" collapses finalConfidence to zero.
export function computeFinalConfidence(
  modelConfidence: number,
  validationStatus: ValidationStatus,
): number {
  return validationStatus === "valid" ? modelConfidence : 0;
}

export function scoreFields(
  extracted: ExtractedField[],
  validations: FieldValidationResult[],
): ScoredField[] {
  const validationByKey = new Map(validations.map((v) => [v.key, v]));

  return extracted.map((field) => {
    const validation = validationByKey.get(field.key);
    if (!validation) {
      throw new Error(`no validation result for field "${field.key}"`);
    }

    return {
      key: field.key,
      rawValue: field.rawValue,
      normalizedValue: validation.normalizedValue,
      modelConfidence: field.modelConfidence,
      validationStatus: validation.validationStatus,
      validationNotes: validation.validationNotes,
      finalConfidence: computeFinalConfidence(field.modelConfidence, validation.validationStatus),
    };
  });
}
