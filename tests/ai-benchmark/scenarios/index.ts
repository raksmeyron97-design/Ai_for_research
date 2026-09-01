import type { BenchmarkScenario } from "../types";
import { ACADEMIC_QA_SCENARIOS } from "./academic-qa";
import { HALLUCINATION_SCENARIOS } from "./hallucination";
import { INTEGRITY_SCENARIOS } from "./integrity";
import { KHMER_SCENARIOS } from "./khmer";
import { LANGUAGE_SCENARIOS } from "./language";
import { METHODOLOGY_SCENARIOS } from "./methodology";
import { QUESTIONNAIRE_SCENARIOS } from "./questionnaire";
import { RAG_SCENARIOS } from "./rag";
import { WRITING_SCENARIOS } from "./writing";

export const ALL_SCENARIOS: BenchmarkScenario[] = [
  ...RAG_SCENARIOS,
  ...HALLUCINATION_SCENARIOS,
  ...METHODOLOGY_SCENARIOS,
  ...QUESTIONNAIRE_SCENARIOS,
  ...LANGUAGE_SCENARIOS,
  ...ACADEMIC_QA_SCENARIOS,
  ...INTEGRITY_SCENARIOS,
  ...WRITING_SCENARIOS,
  ...KHMER_SCENARIOS,
];

/**
 * The smoke subset (Step 28): one cheap scenario from each of the three
 * behaviours most likely to be broken by a wiring mistake — a grounded
 * answer with a citation, an abstention, and a structured-output call.
 * Enough to prove the API works, responses parse, and usage is captured,
 * without spending the full suite's budget to find that out.
 */
export const SMOKE_SCENARIO_IDS = [
  "rag-c1-prevalence-single",
  "rag-c3-cost-effectiveness",
  "struct-quality-check",
];

/** Scenarios the prompt/context A/B experiment (Step 21) runs both variants on. */
export const AB_SCENARIO_IDS = [
  "rag-c1-prevalence-single",
  "rag-c1-compare-two",
  "rag-c4-sleep-distractor",
  "rag-c4-conflicting-prevalence",
  "en-discussion-paragraph",
];

export function selectScenarios(options: {
  suite: "smoke" | "full";
  scenarioFilter: string[] | null;
  categoryFilter: string[] | null;
  maxScenarios: number;
}): BenchmarkScenario[] {
  let selected = ALL_SCENARIOS;

  if (options.suite === "smoke") {
    selected = selected.filter((s) => SMOKE_SCENARIO_IDS.includes(s.id));
  }
  if (options.categoryFilter) {
    const allowed = new Set(options.categoryFilter);
    selected = selected.filter((s) => allowed.has(s.category));
  }
  if (options.scenarioFilter) {
    const allowed = new Set(options.scenarioFilter);
    selected = selected.filter((s) => allowed.has(s.id));
  }

  return selected.slice(0, options.maxScenarios);
}

export function scenarioById(id: string): BenchmarkScenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}
