import type { BenchmarkScenario } from "../types";

const A = "domain_a_perinatal_mental_health";
const B = "domain_b_maternal_nutrition";

/**
 * Phase 16B §5A — the front-of-thesis writing tasks the suite did not
 * previously exercise: problem statement, rationale, and conclusion. Each
 * routes through a different production prompt builder, so leaving them out
 * meant three shipped prompts were never measured.
 */
export const WRITING_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "write-problem-statement",
    category: "english_writing",
    difficulty: "medium",
    language: "en",
    task: "problem_statement",
    corpus: A,
    retrievedKeys: ["sok2024antenatal", "vann2020screening"],
    input:
      "Draft a problem statement for a cross-sectional study of depression screening competency among midwives at urban health centres. Use only the provided sources.",
    expected_behavior:
      "States magnitude, the gap (competency and ascertainment, not prevalence alone), and why it matters, citing only provided sources and inventing no national statistic.",
    ground_truth:
      "Only 21.4% prevalence and the single-vs-repeated screening ascertainment finding are available; anything else is unsupported.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["sok2024antenatal"],
      mustMention: [["screening"], ["midwi", "provider", "competen"]],
      allowedNumbers: ["21.4", "18.2", "24.9", "612", "1.92", "2.34", "95"],
      maxWords: 500,
    },
  },
  {
    id: "write-rationale",
    category: "english_writing",
    difficulty: "hard",
    language: "en",
    task: "rationale",
    corpus: A,
    retrievedKeys: ["pen2021support", "vann2020screening"],
    input: "Write the rationale for this study, justifying why it is needed now, based only on the provided sources.",
    expected_behavior:
      "Builds the justification from the sources' own stated gaps (few studies separating instrumental from emotional support; no treatment-effectiveness evaluation) rather than asserting field-wide urgency.",
    ground_truth: "Justification must be traceable to the two sources' stated limitations.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["pen2021support", "vann2020screening"],
      mustMention: [["gap", "limited", "few studies", "not established"]],
      maxWords: 500,
    },
  },
  {
    id: "write-conclusion",
    category: "english_writing",
    difficulty: "hard",
    language: "en",
    task: "conclusion",
    corpus: A,
    retrievedKeys: ["sok2024antenatal"],
    input:
      "Write a conclusion and one recommendation. Findings supplied: probable antenatal depression 21.4%; low perceived partner support associated with higher symptoms (aOR 2.34).",
    expected_behavior:
      "Synthesises only the supplied findings, introduces no new statistic, ties the recommendation to a specific finding and names who should act on it, and does not claim causation.",
    ground_truth: "Conclusion restates supplied findings only; recommendation maps finding → action → actor.",
    retrieval_required: true,
    citation_required: false,
    expect: {
      mustMention: [["21.4"], ["recommend"], ["associat", "not caus", "cannot"]],
      allowedNumbers: ["21.4", "2.34", "18.2", "24.9", "612", "95", "1.92"],
      maxWords: 400,
    },
  },
  {
    id: "write-conclusion-unaddressed-objective",
    category: "english_writing",
    difficulty: "hard",
    language: "en",
    task: "conclusion",
    input:
      "Write my conclusion. Objectives: (1) determine prevalence of probable antenatal depression; (2) assess midwives' screening competency. Findings supplied: prevalence was 21.4%. No competency data was collected.",
    expected_behavior:
      "Concludes on objective 1 and states explicitly that objective 2 was not addressed by the findings, rather than quietly omitting it or inventing a competency result.",
    ground_truth: "Objective 2 has no findings; the production conclusion prompt requires saying so explicitly.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["competen"], ["not", "no data", "was not addressed", "not collected"]],
      mustNotContain: ["competency was high", "midwives demonstrated"],
      allowedNumbers: ["21.4", "1", "2"],
      maxWords: 400,
    },
  },
  {
    id: "write-rewrite-preserve-meaning",
    category: "english_writing",
    difficulty: "hard",
    language: "en",
    task: "rewrite",
    corpus: B,
    retrievedKeys: ["kim2023dietdiversity"],
    input:
      "Rewrite academically without changing any factual claim: \"We found that 38.6% of the women met minimum dietary diversity, and anaemia was more common in the women who did not meet it, though we cannot say one caused the other.\"",
    expected_behavior:
      "Improves register while preserving 38.6%, the direction of the association, and the explicit no-causation hedge. A fluent rewrite that drops the hedge is a failure.",
    ground_truth: "Both the figure and the causal disclaimer must survive the rewrite.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["38.6"], ["caus", "association", "cannot"]],
      allowedNumbers: ["38.6", "29.1", "34.7", "20.2"],
      maxWords: 150,
    },
  },
];
