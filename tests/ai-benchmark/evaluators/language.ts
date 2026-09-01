import type { BenchmarkScenario, EvaluationDetail } from "../types";
import { khmerCharRatio, latinCharRatio } from "./text";

/**
 * Khmer/English language quality, automated portion only.
 *
 * This measures what code can actually verify — that the answer is in the
 * requested script, that English has not leaked in beyond retained
 * technical terms, and that a technical term is rendered the same way every
 * time it appears. Naturalness, register and academic tone are NOT scored
 * here; they are judge/human dimensions, and pretending a regex can rate
 * them would be the exact kind of unbacked claim this phase exists to
 * remove.
 *
 * The English-leakage threshold is deliberately generous (40%): the
 * project's own default prompt instructs the model to keep English
 * methodological terms alongside the Khmer, so a Khmer answer is *expected*
 * to contain Latin script.
 */
const MIN_KHMER_RATIO = 0.5;
const MAX_LATIN_RATIO_IN_KHMER = 0.4;

export function evaluateLanguage(scenario: BenchmarkScenario, output: string): EvaluationDetail[] {
  const details: EvaluationDetail[] = [];

  if (scenario.language === "km") {
    const khmer = khmerCharRatio(output);
    const latin = latinCharRatio(output);
    const scriptOk = khmer >= MIN_KHMER_RATIO;
    const leakageOk = latin <= MAX_LATIN_RATIO_IN_KHMER;

    details.push({
      evaluator: "khmer_script",
      passed: scriptOk && leakageOk,
      score: Math.min(100, (khmer / MIN_KHMER_RATIO) * 100) * (leakageOk ? 1 : 0.5),
      notes: [
        `Khmer character ratio ${(khmer * 100).toFixed(1)}% (min ${MIN_KHMER_RATIO * 100}%)`,
        `Latin character ratio ${(latin * 100).toFixed(1)}% (max ${MAX_LATIN_RATIO_IN_KHMER * 100}%)`,
        scriptOk ? "answered in Khmer" : "did not answer in Khmer as instructed",
      ],
    });
  }

  if (scenario.expect.consistentTerms?.length) {
    const notes: string[] = [];
    let inconsistent = 0;
    for (const term of scenario.expect.consistentTerms) {
      // A term is consistent when every occurrence uses one casing/spelling.
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const occurrences = output.match(new RegExp(escaped, "gi")) ?? [];
      const distinct = new Set(occurrences);
      if (occurrences.length > 1 && distinct.size > 1) {
        inconsistent += 1;
        notes.push(`"${term}" rendered ${distinct.size} different ways: ${[...distinct].join(" | ")}`);
      } else if (occurrences.length === 0) {
        notes.push(`"${term}" never appeared`);
      }
    }
    const total = scenario.expect.consistentTerms.length;
    details.push({
      evaluator: "terminology_consistency",
      passed: inconsistent === 0,
      score: ((total - inconsistent) / total) * 100,
      notes: notes.length ? notes : ["terminology used consistently"],
    });
  }

  return details;
}
