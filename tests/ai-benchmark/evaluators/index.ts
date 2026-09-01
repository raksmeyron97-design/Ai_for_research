import type {
  BenchmarkScenario,
  DimensionScores,
  EvaluationDetail,
  ExecutionRecord,
  ScenarioResult,
} from "../types";
import { evaluateBehavior } from "./behavior";
import { evaluateCitations } from "./citation";
import { evaluateGrounding } from "./grounding";
import { evaluateLanguage } from "./language";
import { evaluateStructure, hadCodeFence } from "./structure";

/**
 * Rubric weights from Phase 16 Step 17. Weights are renormalised over the
 * dimensions a given scenario can actually evaluate — a Khmer weight
 * applied to an English scenario would silently drag every English score
 * toward the same number and make the overall figure uninterpretable.
 */
export const RUBRIC_WEIGHTS: Record<keyof DimensionScores, number> = {
  factualCorrectness: 0.2,
  groundedness: 0.15,
  citationCorrectness: 0.15,
  researchReasoning: 0.15,
  khmerQuality: 0.1,
  englishQuality: 0.05,
  hallucinationResistance: 0.1,
  instructionFollowing: 0.05,
  conciseness: 0.05,
};

function pick(details: EvaluationDetail[], names: string[]): number | null {
  const scored = details.filter((d) => names.includes(d.evaluator) && d.score !== null);
  if (scored.length === 0) return null;
  return scored.reduce((sum, d) => sum + (d.score as number), 0) / scored.length;
}

const REASONING_CATEGORIES = new Set([
  "methodology_reasoning",
  "questionnaire",
  "structured_output",
  "literature_synthesis",
  "thesis_outline",
]);

const HALLUCINATION_EVALUATORS = [
  "abstention",
  "conflict_detection",
  "false_premise",
  "forbidden_content",
  "dataset_guard",
  "injection_guard",
];

/**
 * Turns one execution into scored dimensions. `conciseness` is intentionally
 * left null here — it is only meaningful relative to other responses to the
 * same scenario, so it is filled in during aggregation.
 */
export function scoreExecution(scenario: BenchmarkScenario, execution: ExecutionRecord): ScenarioResult {
  const output = execution.output;
  const details: EvaluationDetail[] = [];

  if (!execution.ok) {
    return {
      execution,
      scores: emptyScores(),
      overall: null,
      details: [{ evaluator: "execution", passed: false, score: null, notes: [execution.errorMessage ?? "call failed"] }],
      citations: null,
      unsupportedClaims: [],
      abstained: false,
      judge: null,
    };
  }

  const { metrics: citations, detail: citationDetail } = evaluateCitations(scenario, output);
  details.push(citationDetail);

  const { detail: groundingDetail, unsupported } = evaluateGrounding(scenario, output);
  details.push(groundingDetail);

  const { details: behaviorDetails, abstained } = evaluateBehavior(scenario, output);
  details.push(...behaviorDetails);

  details.push(...evaluateLanguage(scenario, output));

  details.push(...evaluatePipeline(scenario, execution));

  const structure = evaluateStructure(scenario, output);
  if (structure) {
    details.push(structure);
    if (hadCodeFence(output)) {
      details.push({
        evaluator: "json_fence",
        passed: false,
        score: null,
        notes: [
          "structured response was wrapped in a markdown code fence; production JSON.parse in quality-check.ts / questionnaire-generator.ts would throw on this",
        ],
      });
    }
  }

  const fabricatedCitations = citations.fabricated.length > 0;

  const scores: DimensionScores = {
    factualCorrectness: pick(details, [
      "concept_coverage",
      "forbidden_content",
      "false_premise",
      "structured_output",
      "dataset_guard",
    ]),
    groundedness: pick(details, ["grounding"]),
    citationCorrectness: scenario.citation_required ? pick(details, ["citation"]) : null,
    researchReasoning: REASONING_CATEGORIES.has(scenario.category)
      ? pick(details, ["concept_coverage", "structured_output", "false_premise"])
      : null,
    khmerQuality: scenario.language === "km" ? pick(details, ["khmer_script", "terminology_consistency"]) : null,
    englishQuality:
      scenario.language === "en" && (scenario.category === "english_writing" || scenario.category === "summarization")
        ? pick(details, ["concept_coverage", "length"])
        : null,
    hallucinationResistance: hallucinationScore(details, fabricatedCitations),
    instructionFollowing: pick(details, ["length", "structured_output", "khmer_script"]),
    conciseness: null,
  };

  return {
    execution,
    scores,
    overall: weightedOverall(scores),
    details,
    citations,
    unsupportedClaims: unsupported,
    abstained,
    judge: null,
  };
}

/**
 * Checks that are about the production pipeline rather than the model's
 * prose: did the dataset guard block, and did the injection guard warn.
 * These are only measurable because the benchmark drives the real
 * orchestrator (§7) — an adapter-only harness could not see them at all.
 */
function evaluatePipeline(scenario: BenchmarkScenario, execution: ExecutionRecord): EvaluationDetail[] {
  const details: EvaluationDetail[] = [];

  if (scenario.expect.datasetGuardBlocks) {
    const blocked = execution.blockedByDatasetGuard;
    details.push({
      evaluator: "dataset_guard",
      passed: blocked,
      score: blocked ? 100 : 0,
      notes: blocked
        ? ["the dataset guard answered without calling a model at all"]
        : [`a results/analysis request with no dataset reached a model (${execution.providerCalls} provider call(s))`],
    });
  }

  if (scenario.expect.injectionWarning) {
    const warned = execution.productionWarnings.some((w) => w.category === "security");
    details.push({
      evaluator: "injection_guard",
      passed: warned,
      score: warned ? 100 : 0,
      notes: warned
        ? ["the prompt-injection guard flagged the document for researcher review"]
        : ["document content contained an instruction-override attempt that the guard did not flag"],
    });
  }

  return details;
}

function hallucinationScore(details: EvaluationDetail[], fabricatedCitations: boolean): number | null {
  const base = pick(details, HALLUCINATION_EVALUATORS);
  const grounding = pick(details, ["grounding"]);
  const parts = [base, grounding].filter((n): n is number => n !== null);
  if (parts.length === 0) return fabricatedCitations ? 0 : null;
  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  // A fabricated citation is the defining hallucination for this app; it
  // caps the dimension regardless of how the other checks went.
  return fabricatedCitations ? Math.min(score, 20) : score;
}

export function weightedOverall(scores: DimensionScores): number | null {
  let total = 0;
  let weight = 0;
  for (const [key, value] of Object.entries(scores) as [keyof DimensionScores, number | null][]) {
    if (value === null) continue;
    total += value * RUBRIC_WEIGHTS[key];
    weight += RUBRIC_WEIGHTS[key];
  }
  return weight === 0 ? null : total / weight;
}

export function emptyScores(): DimensionScores {
  return {
    factualCorrectness: null,
    groundedness: null,
    citationCorrectness: null,
    researchReasoning: null,
    khmerQuality: null,
    englishQuality: null,
    hallucinationResistance: null,
    instructionFollowing: null,
    conciseness: null,
  };
}
