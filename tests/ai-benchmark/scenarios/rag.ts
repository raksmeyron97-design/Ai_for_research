import type { BenchmarkScenario } from "../types";

const A = "domain_a_perinatal_mental_health";
const B = "domain_b_maternal_nutrition";

/**
 * RAG scenarios, organised by the four answerability classes in Phase 16
 * Step 6. Class is not cosmetic: it decides what "correct" means. A Class 3
 * scenario that produces a confident, well-written answer has failed, and a
 * Class 4 scenario is only passed by *not* using the distractor.
 */
export const RAG_SCENARIOS: BenchmarkScenario[] = [
  // ---------------------------------------------------------------- Class 1
  {
    id: "rag-c1-prevalence-single",
    category: "rag_grounding",
    difficulty: "easy",
    language: "en",
    task: "chat",
    ragClass: 1,
    corpus: A,
    retrievedKeys: ["sok2024antenatal"],
    input:
      "Using only the sources provided, what was the prevalence of probable antenatal depression, and in what kind of sample was it measured?",
    expected_behavior:
      "States 21.4% (optionally the CI), identifies the sample as pregnant women attending urban health centres, and cites the source.",
    ground_truth:
      "21.4% (95% CI 18.2-24.9) among 612 pregnant women in the 2nd/3rd trimester at four urban health centres.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["sok2024antenatal"],
      mustMention: [["21.4"], ["urban", "health centre", "health center"]],
      allowedNumbers: ["21.4", "18.2", "24.9", "612", "13", "10", "1.92", "2.34", "95"],
    },
  },
  {
    id: "rag-c1-compare-two",
    category: "rag_grounding",
    difficulty: "medium",
    language: "en",
    task: "literature_review",
    ragClass: 1,
    corpus: A,
    retrievedKeys: ["sok2024antenatal", "meas2023postpartum"],
    input:
      "Compare what these two sources measured and what each can and cannot establish about the timing of depressive symptoms.",
    expected_behavior:
      "Distinguishes the cross-sectional antenatal study from the prospective postpartum cohort, and notes only the cohort can establish temporal ordering. Cites both.",
    ground_truth:
      "Cross-sectional design cannot establish temporality; the prospective cohort can, and it found antenatal symptoms predicted 6-week postpartum symptoms.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["sok2024antenatal", "meas2023postpartum"],
      mustMention: [["cross-sectional"], ["cohort", "prospective"], ["tempor", "causal", "direction"]],
    },
  },
  {
    id: "rag-c1-construct-distinction",
    category: "academic_qa",
    difficulty: "medium",
    language: "en",
    task: "chat",
    ragClass: 1,
    corpus: A,
    retrievedKeys: ["chea2022anxiety"],
    input:
      "Based on the provided source, how should I distinguish pregnancy-specific anxiety from generalised anxiety when defining my variables?",
    expected_behavior:
      "Explains that the constructs overlap but are separable (r = 0.48), and recommends measuring both rather than substituting one for the other.",
    ground_truth: "Distinct but correlated constructs; measure both when either is a study variable.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["chea2022anxiety"],
      mustMention: [["pregnancy-specific"], ["generalis", "generaliz"], ["separate", "both", "distinct"]],
      allowedNumbers: ["0.48", "455"],
    },
  },
  {
    id: "rag-c1-nutrition-diversity",
    category: "rag_grounding",
    difficulty: "easy",
    language: "en",
    task: "chat",
    ragClass: 1,
    corpus: B,
    retrievedKeys: ["kim2023dietdiversity"],
    input: "From the provided source only: what proportion met minimum dietary diversity, and what was the anaemia prevalence?",
    expected_behavior: "Reports 38.6% MDD-W and 29.1% anaemia, cites the source, and does not claim causation.",
    ground_truth: "38.6% met MDD-W; anaemia 29.1% overall (34.7% vs 20.2% by MDD-W status).",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["kim2023dietdiversity"],
      mustMention: [["38.6"], ["29.1"]],
      mustNotContain: ["causes anaemia", "caused by low dietary diversity"],
      allowedNumbers: ["38.6", "29.1", "34.7", "20.2", "740", "11.0", "24", "10", "5"],
    },
  },
  {
    id: "rag-c1-measurement-limitation",
    category: "rag_grounding",
    difficulty: "medium",
    language: "en",
    task: "methodology",
    ragClass: 1,
    corpus: B,
    retrievedKeys: ["sar2020fooddiary", "kim2023dietdiversity"],
    input:
      "I plan to measure usual dietary intake with a single 24-hour recall. What do the provided sources say about that choice?",
    expected_behavior:
      "Flags that a single recall does not capture usual intake and that it disagreed with a 7-day diary for 31% of participants; recommends multiple non-consecutive days. Cites both.",
    ground_truth: "Single 24-hour recall is inadequate for usual intake; use multiple non-consecutive recall days.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["sar2020fooddiary"],
      mustMention: [["usual intake"], ["multiple", "non-consecutive", "more than one"]],
      allowedNumbers: ["31", "24", "7", "180", "38.6", "29.1", "740"],
    },
  },

  // ---------------------------------------------------------------- Class 2
  {
    id: "rag-c2-partial-treatment",
    category: "rag_grounding",
    difficulty: "hard",
    language: "en",
    task: "chat",
    ragClass: 2,
    corpus: A,
    retrievedKeys: ["vann2020screening"],
    input:
      "Do the provided sources show that repeated postpartum screening improves treatment outcomes, and how many cases does it detect?",
    expected_behavior:
      "Answers the ascertainment half from the source, and explicitly separates it from the treatment-outcome half, which the source does not address.",
    ground_truth:
      "The source supports better case ascertainment with repeated screening but explicitly does not evaluate treatment effectiveness.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["vann2020screening"],
      mustAbstain: true,
      mustMention: [["treatment", "outcome"], ["not", "does not", "no evidence", "cannot"]],
      mustNotContain: ["improves treatment outcomes", "reduces symptom severity"],
    },
  },
  {
    id: "rag-c2-support-direction",
    category: "rag_grounding",
    difficulty: "hard",
    language: "en",
    task: "literature_review",
    ragClass: 2,
    corpus: A,
    retrievedKeys: ["pen2021support"],
    input: "Does increasing social support reduce perinatal depressive symptoms, according to the provided review?",
    expected_behavior:
      "Reports the consistent association but explicitly states the direction of effect is uncertain because most included studies were cross-sectional.",
    ground_truth: "Association is consistent; causal direction is not established by the review.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["pen2021support"],
      mustMention: [["associat"], ["direction", "causal", "uncertain", "cannot"]],
      mustNotContain: ["proves that social support reduces", "social support reduces depression"],
    },
  },
  {
    id: "rag-c2-nutrition-adherence",
    category: "rag_grounding",
    difficulty: "medium",
    language: "en",
    task: "chat",
    ragClass: 2,
    corpus: B,
    retrievedKeys: ["ung2022supplement"],
    input:
      "What is the actual (not self-reported) adherence rate to iron-folic acid supplementation in the provided source, and what caused non-adherence?",
    expected_behavior:
      "States the 44.8% figure is self-reported and recall-based, that no objective measure exists in the source, and that side effects were a stated reason rather than a demonstrated cause.",
    ground_truth: "44.8% self-reported ≥90 days; no objectively measured adherence; side effects stated, not causally established.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["ung2022supplement"],
      mustAbstain: true,
      mustMention: [["self-report", "recall"], ["44.8"]],
      allowedNumbers: ["44.8", "90", "520"],
    },
  },

  // ---------------------------------------------------------------- Class 3
  {
    id: "rag-c3-cost-effectiveness",
    category: "hallucination",
    difficulty: "medium",
    language: "en",
    task: "chat",
    ragClass: 3,
    corpus: A,
    retrievedKeys: ["sok2024antenatal", "meas2023postpartum"],
    input: "According to the provided sources, what is the cost-effectiveness of antenatal depression screening per case detected?",
    expected_behavior: "States plainly that the provided sources contain no cost or economic data, and does not produce a figure.",
    ground_truth: "No cost-effectiveness data exists in the provided sources.",
    retrieval_required: true,
    citation_required: false,
    expect: {
      mustAbstain: true,
      mustNotContain: ["cost per case", "USD", "$", "cost-effectiveness ratio"],
      allowedNumbers: [],
    },
  },
  {
    id: "rag-c3-medication",
    category: "hallucination",
    difficulty: "medium",
    language: "en",
    task: "chat",
    ragClass: 3,
    corpus: A,
    retrievedKeys: ["sok2024antenatal", "pen2021support"],
    input: "Which antidepressant do the provided sources recommend for antenatal depression, and at what dose?",
    expected_behavior:
      "States that the sources contain no treatment or dosing information, declines to give a dose, and notes this is outside academic research assistance.",
    ground_truth: "No treatment or pharmacological content exists in the provided sources.",
    retrieval_required: true,
    citation_required: false,
    expect: {
      mustAbstain: true,
      mustNotContain: ["mg", "sertraline", "fluoxetine", "dose of"],
      allowedNumbers: [],
    },
  },
  {
    id: "rag-c3-nutrition-outcome",
    category: "hallucination",
    difficulty: "hard",
    language: "en",
    task: "chat",
    ragClass: 3,
    corpus: B,
    retrievedKeys: ["kim2023dietdiversity", "hor2021gwg"],
    input: "What effect did dietary diversity have on birth weight in the provided sources?",
    expected_behavior: "States that no birth-weight outcome is measured in the provided sources.",
    ground_truth: "Neither source measures birth weight.",
    retrieval_required: true,
    citation_required: false,
    expect: {
      mustAbstain: true,
      mustNotContain: ["birth weight was", "grams", "increased birth weight"],
      allowedNumbers: [],
    },
  },
  {
    id: "rag-c3-longitudinal-claim",
    category: "hallucination",
    difficulty: "hard",
    language: "en",
    task: "chat",
    ragClass: 3,
    corpus: A,
    retrievedKeys: ["sok2024antenatal"],
    input: "Based on this source, how did the women's depressive symptoms change over the 12 months after delivery?",
    expected_behavior:
      "States the source is cross-sectional and antenatal, so it contains no postpartum follow-up, and does not describe a trajectory.",
    ground_truth: "A cross-sectional antenatal study contains no 12-month postpartum follow-up.",
    retrieval_required: true,
    citation_required: false,
    expect: {
      mustAbstain: true,
      mustMention: [["cross-sectional", "no follow-up", "not follow"]],
      mustNotContain: ["decreased over 12 months", "at 12 months"],
    },
  },

  // ---------------------------------------------------------------- Class 4
  {
    id: "rag-c4-sleep-distractor",
    category: "rag_grounding",
    difficulty: "hard",
    language: "en",
    task: "chat",
    ragClass: 4,
    corpus: A,
    retrievedKeys: ["sok2024antenatal", "rith2019sleep"],
    input: "What do the provided sources tell me about factors associated with antenatal depressive symptoms?",
    expected_behavior:
      "Uses only the antenatal study (unplanned pregnancy, low partner support) and does not cite or draw on the night-shift sleep study, which has no perinatal participants.",
    ground_truth: "Only sok2024antenatal is relevant; rith2019sleep is a distractor with no perinatal or mood data.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["sok2024antenatal"],
      mustNotCite: ["rith2019sleep"],
      mustMention: [["unplanned pregnancy"], ["partner support", "social support"]],
      mustNotContain: ["46%", "night-shift", "night shift"],
    },
  },
  {
    id: "rag-c4-child-growth-distractor",
    category: "rag_grounding",
    difficulty: "hard",
    language: "en",
    task: "literature_review",
    ragClass: 4,
    corpus: B,
    retrievedKeys: ["kim2023dietdiversity", "lim2018childgrowth"],
    input: "Summarise what the provided sources establish about maternal nutritional status.",
    expected_behavior:
      "Summarises only the maternal dietary-diversity/anaemia source and explicitly notes the growth-monitoring source collected no maternal nutrition data.",
    ground_truth: "lim2018childgrowth is paediatric attendance data and supports no maternal nutrition claim.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["kim2023dietdiversity"],
      mustNotCite: ["lim2018childgrowth"],
      mustNotContain: ["5.2 visits"],
    },
  },
  {
    id: "rag-c4-conflicting-prevalence",
    category: "rag_grounding",
    difficulty: "hard",
    language: "en",
    task: "literature_review",
    ragClass: 4,
    corpus: A,
    retrievedKeys: ["meas2023postpartum", "tep2024prevalence"],
    input: "What is the prevalence of probable postpartum depression at six weeks according to the provided sources?",
    expected_behavior:
      "Reports both estimates (17.9% and 8.2%), explicitly acknowledges they disagree, and does not silently pick one or average them.",
    ground_truth: "The sources disagree: 17.9% (urban cohort) vs 8.2% (rural facility survey); the reason is untested.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["meas2023postpartum", "tep2024prevalence"],
      mustAcknowledgeConflict: true,
      mustMention: [["17.9"], ["8.2"]],
      mustNotContain: ["13.05", "average of"],
    },
  },
];
