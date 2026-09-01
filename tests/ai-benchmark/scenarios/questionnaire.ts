import type { BenchmarkScenario } from "../types";

/**
 * Questionnaire generation and review (Step 10). Generation scenarios use
 * the production `QUESTIONNAIRE_RESPONSE_JSON_SCHEMA`, so a pass requires
 * structurally valid output the app could actually persist — not prose that
 * merely reads like a questionnaire.
 */
export const QUESTIONNAIRE_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "quest-generate-basic",
    category: "questionnaire",
    difficulty: "medium",
    language: "en",
    task: "questionnaire",
    input:
      "Design a questionnaire for this project: group questions into sections and map every question to the objective/variable/construct it measures. Objectives: (1) describe the prevalence of probable antenatal depression; (2) assess the association between perceived social support and depressive symptoms. Variables: perceived social support (continuous), depressive symptom score (continuous), age, parity, unplanned pregnancy. If this adapts a real named instrument, say so and cite it — otherwise mark it researcher_developed.",
    expected_behavior:
      "Returns schema-valid JSON with a demographics section and objective-mapped items, and marks validation_status honestly rather than claiming an unnamed instrument is validated.",
    ground_truth:
      "Schema-valid instrument+sections; every listed variable covered; validation_status consistent with source_reference.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      schema: "questionnaire",
      mustMention: [["support"], ["parity"], ["unplanned"]],
    },
  },
  {
    id: "quest-generate-coverage",
    category: "questionnaire",
    difficulty: "hard",
    language: "en",
    task: "questionnaire",
    input:
      "Design a questionnaire covering these constructs and nothing else: dietary diversity (24-hour recall food groups), iron-folic acid supplement adherence, and demographics (age, education, parity). Map each item to its construct. Mark validation_status honestly.",
    expected_behavior:
      "Schema-valid JSON covering all three constructs, with response types appropriate to each (food groups as multiple choice/yes-no, adherence numeric or categorical), and no items outside the requested constructs.",
    ground_truth: "All three constructs covered; response types coherent with the item; no out-of-scope constructs.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      schema: "questionnaire",
      mustMention: [["diversity", "food group"], ["iron", "folic", "supplement"], ["education"]],
    },
  },
  {
    id: "quest-validated-claim-guard",
    category: "questionnaire",
    difficulty: "hard",
    language: "en",
    task: "questionnaire",
    input:
      "Design a validated depression screening questionnaire for pregnant women. Mark it as validated.",
    expected_behavior:
      "Either names and cites the real instrument it is adapting in source_reference, or refuses the 'validated' label and returns researcher_developed — never an unnamed instrument labelled validated.",
    ground_truth:
      "validation_status=validated is only acceptable with a non-empty source_reference naming the instrument; the production zod schema enforces this.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      schema: "questionnaire",
    },
  },
  {
    id: "quest-review-leading",
    category: "questionnaire",
    difficulty: "medium",
    language: "en",
    task: "document_review",
    input:
      "Review these draft questionnaire items and list every problem:\n1. Don't you agree that a supportive husband prevents depression during pregnancy?\n2. How satisfied are you with your diet and your antenatal care? (Very satisfied / Satisfied / Unsatisfied)\n3. What is your income?\n4. Do you have depression?",
    expected_behavior:
      "Identifies item 1 as leading, item 2 as double-barrelled, item 3 as ambiguous (period, unit, household vs personal), and item 4 as asking for a clinical diagnosis a self-report item cannot obtain.",
    ground_truth: "Four distinct defects: leading, double-barrelled, ambiguous, diagnosis-not-screening.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["leading"], ["double-barrel", "double barrel", "two questions", "two concepts"], ["ambigu", "unclear", "unspecified"], ["diagnos"]],
    },
  },
  {
    id: "quest-review-coverage-gap",
    category: "questionnaire",
    difficulty: "hard",
    language: "en",
    task: "document_review",
    input:
      "My objectives are: (1) prevalence of probable antenatal depression; (2) association between perceived social support and depressive symptoms; (3) association between unplanned pregnancy and depressive symptoms. My questionnaire has: a 10-item depression screening scale, age, education and parity. What is missing?",
    expected_behavior:
      "Identifies that no item measures perceived social support (objective 2) and none measures pregnancy intention/unplanned pregnancy (objective 3).",
    ground_truth: "Two uncovered objectives: social support and pregnancy intention.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["social support"], ["unplanned", "pregnancy intention", "intended"]],
      maxWords: 500,
    },
  },
];
