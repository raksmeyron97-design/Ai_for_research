/** Shared text primitives for the deterministic evaluators. */

/** Khmer Unicode block. */
const KHMER = /[ក-៿]/;

export function khmerCharRatio(text: string): number {
  const letters = [...text].filter((c) => /\S/.test(c) && !/[\d\p{P}\p{S}]/u.test(c));
  if (letters.length === 0) return 0;
  return letters.filter((c) => KHMER.test(c)).length / letters.length;
}

export function latinCharRatio(text: string): number {
  const letters = [...text].filter((c) => /\S/.test(c) && !/[\d\p{P}\p{S}]/u.test(c));
  if (letters.length === 0) return 0;
  return letters.filter((c) => /[A-Za-z]/.test(c)).length / letters.length;
}

/**
 * Khmer has no spaces between words, so a space-split word count is
 * meaningless for it. Latin words are counted as words; Khmer is counted in
 * 4-character units, a rough but stable proxy that keeps the `maxWords`
 * check from silently passing every Khmer answer.
 */
export function countWords(text: string): number {
  const latin = (text.match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) ?? []).length;
  const khmerChars = [...text].filter((c) => KHMER.test(c)).length;
  return latin + Math.ceil(khmerChars / 4);
}

/** Splits into sentences across both Latin and Khmer terminators. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?។])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Numeric tokens a response asserts, normalised (percent signs and commas removed). */
export function extractNumbers(text: string): string[] {
  const matches = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return matches.map((m) => m.replace(/,/g, ""));
}

export function containsAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

/**
 * Insufficiency / abstention markers in English and Khmer. Deliberately
 * phrase-level rather than single words: "not" alone appears in almost any
 * answer and would make abstention detection meaningless.
 */
export const ABSTENTION_MARKERS = [
  "do not contain", "does not contain", "not contain",
  "do not provide", "does not provide", "not provided",
  "do not report", "does not report", "not reported",
  "do not include", "does not include",
  "do not address", "does not address", "not addressed",
  "do not measure", "does not measure", "not measured",
  "do not evaluate", "does not evaluate", "not evaluate",
  "do not establish", "does not establish", "not establish",
  "no information", "no data", "no evidence", "no source",
  "insufficient", "cannot verify", "cannot be verified", "unable to verify",
  "cannot answer", "cannot determine", "cannot confirm", "cannot be determined",
  "not available in", "outside the scope", "beyond the scope",
  "needs verification", "requires verification", "source_required",
  "was not provided", "were not provided", "not in the provided",
  "មិនមាន", "គ្មាន", "មិនអាចបញ្ជាក់", "ត្រូវការការផ្ទៀងផ្ទាត់",
];

export const CONFLICT_MARKERS = [
  "differ", "disagree", "conflict", "inconsistent", "discrepan",
  "contrast", "however", "whereas", "lower than", "higher than",
  "not consistent", "vary", "varies", "two estimates", "both estimates",
  "ខុសគ្នា", "មិនស្របគ្នា",
];

export const CORRECTION_MARKERS = [
  "does not prove", "do not prove", "cannot establish", "cannot prove",
  "is not accurate", "is incorrect", "not correct", "actually",
  "in fact", "the source reports", "the source states", "correction",
  "rather than", "instead", "should be", "misstate", "not supported",
  "cannot conclude", "does not show", "do not show",
  "មិនត្រឹមត្រូវ", "តាមពិត",
];
