import { extractCitationKeys } from "@/lib/ai/integrity-guard";
import { allKnownCitationKeys } from "../fixtures/corpus";
import type { BenchmarkScenario, CitationMetrics, EvaluationDetail } from "../types";

/**
 * Citation evaluation, using the *production* key extractor
 * (`integrity-guard.ts:extractCitationKeys`) so the benchmark measures what
 * the app would actually detect, bracket convention and all.
 *
 * "Citation present" is not scored anywhere here. What is scored:
 *  - correct: an expected supporting key was cited
 *  - mismatched: a real corpus key cited where it does not support the claim
 *  - fabricated: a key that exists in no corpus at all
 *
 * Bracket tokens that are formatting rather than citations (`[1]`, `[i]`,
 * `[Note]`) are filtered out; production's own extractor does not do this,
 * which is itself a finding rather than something to paper over here.
 */
const NON_CITATION_TOKENS = /^(?:\d+|[ivxIVX]+|note|sic|Note|citation_key|key|source|ref|A|B)$/;

export function evaluateCitations(
  scenario: BenchmarkScenario,
  output: string,
): { metrics: CitationMetrics; detail: EvaluationDetail } {
  const known = allKnownCitationKeys();
  const raw = extractCitationKeys(output);
  const cited = raw.filter((k) => !NON_CITATION_TOKENS.test(k));

  const expected = scenario.expect.mustCite ?? [];
  const forbidden = scenario.expect.mustNotCite ?? [];

  const correct = expected.filter((k) => cited.includes(k));
  const fabricated = cited.filter((k) => !known.has(k));
  const mismatched = cited.filter(
    (k) => known.has(k) && (forbidden.includes(k) || (expected.length > 0 && !expected.includes(k))),
  );

  const precision = cited.length > 0 ? correct.length / cited.length : null;
  const recall = expected.length > 0 ? correct.length / expected.length : null;

  const notes: string[] = [];
  if (fabricated.length) notes.push(`fabricated citation keys: ${fabricated.join(", ")}`);
  if (mismatched.length) notes.push(`cited a source that does not support the claim: ${mismatched.join(", ")}`);
  const missing = expected.filter((k) => !cited.includes(k));
  if (missing.length) notes.push(`missing required citations: ${missing.join(", ")}`);
  if (!scenario.citation_required && cited.length === 0) notes.push("no citations required or produced");

  // Score is only defined when the scenario actually asked for citations.
  let score: number | null = null;
  if (scenario.citation_required) {
    if (fabricated.length > 0) {
      score = 0;
    } else {
      const p = precision ?? 0;
      const r = recall ?? (cited.length === 0 ? 0 : 1);
      score = expected.length > 0 ? (2 * p * r) / (p + r || 1) * 100 : p * 100;
      if (mismatched.length > 0) score = Math.min(score, 50);
    }
  }

  return {
    metrics: { cited, expected, correct: correct.length, mismatched, fabricated, precision, recall },
    detail: {
      evaluator: "citation",
      passed: fabricated.length === 0 && missing.length === 0 && mismatched.length === 0,
      score,
      notes,
    },
  };
}
