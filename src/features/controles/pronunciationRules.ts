import type { PronunciationErrorCode, PronunciationLimits } from "../../api/pronunciation.js";

export interface PronunciationRow {
  id: string;
  match: string;
  replace: string;
}

export type RowErrors = { match?: PronunciationErrorCode; replace?: PronunciationErrorCode };
export type RowErrorMap = Record<string, RowErrors>;

// Mirrors the server rule: sentence terminators, newlines and markup/emphasis
// characters would move chunk boundaries or leak formatting into speech.
const FORBIDDEN_REPLACE = /[.!?…\n\r<>*]/;

/** Client-side mirror of the server validation. Rows with no problems are omitted. */
export function validatePronunciationRows(rows: PronunciationRow[], limits: PronunciationLimits): RowErrorMap {
  const out: RowErrorMap = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const errors: RowErrors = {};
    const key = row.match.trim().toLowerCase();
    if (key === "") {
      errors.match = "empty";
    } else if (row.match.trim().length > limits.match_max) {
      errors.match = "too_long";
    } else if (seen.has(key)) {
      errors.match = "duplicate";
    }
    if (key !== "") seen.add(key);
    if (row.replace.length > limits.replace_max) {
      errors.replace = "too_long";
    } else if (FORBIDDEN_REPLACE.test(row.replace)) {
      errors.replace = "forbidden_char";
    }
    if (errors.match || errors.replace) out[row.id] = errors;
  }
  return out;
}
