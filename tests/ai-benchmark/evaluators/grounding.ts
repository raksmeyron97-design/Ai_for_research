import { buildScenarioContext } from "../fixtures/context";
import type { BenchmarkScenario, EvaluationDetail } from "../types";
import { extractNumbers, splitSentences } from "./text";

/**
 * Groundedness, measured the only way that is defensible without a human:
 * numeric provenance. Every number a response asserts must appear either in
 * the retrieved evidence or in the scenario's explicit `allowedNumbers`
 * allowance. A number that appears nowhere is an unsupported claim — this
 * is the single most consequential failure mode for a thesis assistant, and
 * it is checkable exactly rather than approximately.
 *
 * What this deliberately does NOT claim to measure: whether prose claims
 * without numbers are entailed by the sources. That needs a judge or a
 * human; it is scored separately and never folded into this number.
 */
export function evaluateGrounding(
  scenario: BenchmarkScenario,
  output: string,
): { detail: EvaluationDetail; unsupported: string[] } {
  const { text: contextText } = buildScenarioContext(scenario, "keyed");
  const evidenceNumbers = new Set(extractNumbers(contextText));
  // A number the request itself supplied is provenanced by definition: the
  // researcher wrote it. Phase 22 §22G found this as a false positive on
  // `struct-quality-check`, whose material under review — "convenience sample
  // of 100 women" — is in the prompt rather than in a retrieved corpus, so
  // the model echoing "100" back was scored as an unsupported numeric claim.
  //
  // This cannot weaken the check. The model does not write the input, so
  // nothing it fabricates can enter the evidence set this way; what changes
  // is only that quoting the researcher's own figures stops counting as
  // inventing them.
  for (const n of extractNumbers(scenario.input)) evidenceNumbers.add(n);
  const allowed = new Set(scenario.expect.allowedNumbers ?? []);

  // Years, list markers and small ordinals are formatting noise, not claims.
  const isNoise = (n: string) => /^\d{1,2}$/.test(n) || /^(19|20)\d{2}$/.test(n);

  const unsupported: string[] = [];
  for (const sentence of splitSentences(output)) {
    for (const n of extractNumbers(sentence)) {
      if (isNoise(n)) continue;
      if (evidenceNumbers.has(n) || allowed.has(n)) continue;
      unsupported.push(`${n} (in: "${sentence.slice(0, 120)}")`);
    }
  }

  const asserted = splitSentences(output).flatMap((s) => extractNumbers(s)).filter((n) => !isNoise(n));

  // A response that asserts no figures at all has not demonstrated
  // groundedness — it has avoided the question this evaluator asks. Scoring
  // it 100 would reward evasion and inflate every terse or refusing answer,
  // so the dimension is reported as not-evaluable instead. Whether the
  // refusal was correct is the abstention evaluator's job, and whether a
  // required figure is missing is concept_coverage's.
  if (asserted.length === 0) {
    return {
      detail: {
        evaluator: "grounding",
        passed: true,
        score: null,
        notes: ["response asserted no numeric claims; groundedness not evaluable from this answer"],
      },
      unsupported,
    };
  }

  const rate = unsupported.length / asserted.length;

  return {
    detail: {
      evaluator: "grounding",
      passed: unsupported.length === 0,
      score: (1 - rate) * 100,
      notes: unsupported.length
        ? [`${unsupported.length}/${asserted.length} numeric claims not traceable to the provided evidence`, ...unsupported.slice(0, 5)]
        : [`all ${asserted.length} numeric claims traceable to the provided evidence`],
    },
    unsupported,
  };
}
