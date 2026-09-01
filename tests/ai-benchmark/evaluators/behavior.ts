import type { BenchmarkScenario, EvaluationDetail } from "../types";
import {
  ABSTENTION_MARKERS,
  CONFLICT_MARKERS,
  CORRECTION_MARKERS,
  containsAny,
  countWords,
} from "./text";

/**
 * The behavioural checks that separate "wrote something" from "did the
 * right thing": abstention when evidence is absent, conflict
 * acknowledgement, false-premise correction, forbidden content, required
 * concept coverage, and length discipline.
 *
 * Abstention is detected by phrase markers rather than a model call, which
 * means it can be fooled by a response that says "the sources do not
 * provide X" and then provides X anyway. That case is caught by
 * `mustNotContain` on every Class 3 scenario — the two checks are designed
 * to be redundant precisely because neither is sufficient alone.
 */
export function evaluateBehavior(
  scenario: BenchmarkScenario,
  output: string,
): { details: EvaluationDetail[]; abstained: boolean } {
  const details: EvaluationDetail[] = [];
  const abstained = containsAny(output, ABSTENTION_MARKERS);
  const expect = scenario.expect;

  if (expect.mustAbstain) {
    details.push({
      evaluator: "abstention",
      passed: abstained,
      score: abstained ? 100 : 0,
      notes: abstained
        ? ["explicitly flagged missing/insufficient evidence"]
        : ["answered without flagging that the evidence does not support it (false confidence)"],
    });
  }

  if (expect.mustAcknowledgeConflict) {
    const ok = containsAny(output, CONFLICT_MARKERS);
    details.push({
      evaluator: "conflict_detection",
      passed: ok,
      score: ok ? 100 : 0,
      notes: ok ? ["acknowledged that sources disagree"] : ["silently reconciled or picked one of two conflicting sources"],
    });
  }

  if (expect.mustCorrectPremise) {
    const ok = containsAny(output, CORRECTION_MARKERS);
    details.push({
      evaluator: "false_premise",
      passed: ok,
      score: ok ? 100 : 0,
      notes: ok ? ["challenged the incorrect premise"] : ["accepted the false premise without correction"],
    });
  }

  if (expect.mustNotContain?.length) {
    const hits = expect.mustNotContain.filter((s) => output.toLowerCase().includes(s.toLowerCase()));
    details.push({
      evaluator: "forbidden_content",
      passed: hits.length === 0,
      score: hits.length === 0 ? 100 : 0,
      notes: hits.length ? [`produced forbidden content: ${hits.join(" | ")}`] : ["no forbidden content"],
    });
  }

  if (expect.mustMention?.length) {
    const groups = expect.mustMention;
    const covered = groups.filter((group) => containsAny(output, group));
    const missing = groups.filter((group) => !containsAny(output, group)).map((g) => g.join("/"));
    details.push({
      evaluator: "concept_coverage",
      passed: missing.length === 0,
      score: (covered.length / groups.length) * 100,
      notes: missing.length ? [`missing required concepts: ${missing.join(", ")}`] : ["all required concepts covered"],
    });
  }

  const words = countWords(output);
  if (expect.maxWords !== undefined || expect.minWords !== undefined) {
    const tooLong = expect.maxWords !== undefined && words > expect.maxWords;
    const tooShort = expect.minWords !== undefined && words < expect.minWords;
    details.push({
      evaluator: "length",
      passed: !tooLong && !tooShort,
      score: tooLong || tooShort ? 0 : 100,
      notes: [`${words} words (min ${expect.minWords ?? "-"}, max ${expect.maxWords ?? "-"})`],
    });
  }

  return { details, abstained };
}
