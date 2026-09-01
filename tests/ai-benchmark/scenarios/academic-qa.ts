import type { BenchmarkScenario } from "../types";

const A = "domain_a_perinatal_mental_health";
const B = "domain_b_maternal_nutrition";

/**
 * Academic Q&A, research framing, and structured-output scenarios — the
 * everyday assistant surface, plus the two structured calls the app
 * actually persists from (`quality_check`, `alignment`), which are the
 * places a malformed response has a user-visible consequence.
 */
export const ACADEMIC_QA_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "qa-objectives-from-problem",
    category: "academic_qa",
    difficulty: "medium",
    language: "en",
    task: "objective_generation",
    input:
      "My problem statement: probable antenatal depression appears common among women attending urban health centres, but local data on its magnitude and correlates is limited. Draft a general objective and specific objectives.",
    expected_behavior:
      "Returns one general objective and 3-5 specific objectives, each measurable and traceable to the stated problem, with no objective requiring data the design cannot produce.",
    ground_truth: "1 general + 3-5 specific, all measurable, all traceable to magnitude/correlates.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["general objective"], ["specific objective"], ["prevalence", "magnitude", "proportion"]],
    },
  },
  {
    id: "qa-research-questions",
    category: "academic_qa",
    difficulty: "medium",
    language: "en",
    task: "research_question",
    input:
      "Convert these objectives into research questions: (1) determine the prevalence of probable antenatal depression; (2) examine the association between perceived social support and depressive symptoms.",
    expected_behavior:
      "Produces one question per objective, phrased as answerable questions rather than restated objectives, and does not introduce a causal question the design cannot answer.",
    ground_truth: "Two questions, one per objective, association-framed not causal.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["what", "how", "?"], ["associat", "relationship"]],
      mustNotContain: ["Does low social support cause"],
      maxWords: 300,
    },
  },
  {
    id: "qa-conceptual-framework",
    category: "academic_qa",
    difficulty: "hard",
    language: "en",
    task: "conceptual_framework",
    corpus: A,
    retrievedKeys: ["pen2021support", "sok2024antenatal"],
    input:
      "Propose the components of a conceptual framework for perceived social support and antenatal depressive symptoms, based on the provided sources.",
    expected_behavior:
      "Names exposure, outcome, and covariate/confounder blocks, ties each to a provided source where one supports it, and marks anything not supported by the sources as an assumption.",
    ground_truth: "Exposure/outcome/confounder structure, grounded, with unsupported links flagged.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["pen2021support"],
      mustMention: [["exposure", "independent"], ["outcome", "dependent"], ["confound", "covariate"]],
    },
  },
  {
    id: "qa-research-gap",
    category: "literature_synthesis",
    difficulty: "hard",
    language: "en",
    task: "research_gap",
    corpus: A,
    retrievedKeys: ["pen2021support", "vann2020screening", "meas2023postpartum"],
    input: "What evidence gaps do the provided sources themselves identify?",
    expected_behavior:
      "Reports only gaps the sources actually state (few studies separating instrumental from emotional support; no treatment-effectiveness evaluation; attrition/bias in the cohort) and does not invent field-wide gaps.",
    ground_truth: "Gaps must be traceable to the sources' own stated limitations.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["pen2021support", "vann2020screening"],
      mustMention: [["instrumental", "emotional"], ["treatment", "effectiveness"]],
    },
  },
  {
    id: "qa-synthesis-across-domains",
    category: "literature_synthesis",
    difficulty: "hard",
    language: "en",
    task: "literature_review",
    corpus: B,
    retrievedKeys: ["kim2023dietdiversity", "sar2020fooddiary", "ung2022supplement"],
    input:
      "Synthesise what the provided sources establish about measuring maternal nutrition, and where their methods disagree or overlap.",
    expected_behavior:
      "Groups the sources by what each measures, notes the shared measurement-validity theme, and attributes each claim to its source without merging their findings into one unattributed statement.",
    ground_truth: "Three sources, each attributed; shared theme = self-report/recall measurement validity.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["kim2023dietdiversity", "sar2020fooddiary", "ung2022supplement"],
      mustMention: [["recall", "self-report"], ["valid", "measure"]],
    },
  },
  {
    id: "qa-limitations",
    category: "academic_qa",
    difficulty: "medium",
    language: "en",
    task: "chat",
    corpus: A,
    retrievedKeys: ["sok2024antenatal"],
    input: "What limitations should I state for a facility-based cross-sectional study like the provided one?",
    expected_behavior:
      "Names design limitations (no temporality), sampling limitations (facility-based, not population representative) and measurement limitations (screening != diagnosis), consistent with the source.",
    ground_truth: "Temporality, facility-based selection, screening-not-diagnosis.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["sok2024antenatal"],
      mustMention: [["tempor", "causal"], ["facility", "representative", "generalis", "generaliz"], ["screening", "diagnos"]],
    },
  },
  {
    id: "struct-quality-check",
    category: "structured_output",
    difficulty: "medium",
    language: "en",
    task: "quality_check",
    input:
      "Score this research project's quality (methodology, evidence, alignment, writing, references, data integrity, overall — each 0-100) and list specific issues.\n\n## Title\nSocial support and antenatal depression\n\n## Objectives\nDetermine prevalence; examine association with social support.\n\n## Methodology\nCross-sectional survey at one urban health centre, convenience sample of 100 women.\n\n## Instrument\nA 10-item depression screening scale.",
    expected_behavior:
      "Returns schema-valid JSON with all seven scores and issues that name real problems (no social-support instrument, convenience sampling, no sample-size justification).",
    ground_truth: "Schema-valid; at least one issue about the missing social support measure.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      schema: "quality_check",
      mustMention: [["social support"]],
    },
  },
  {
    id: "struct-alignment",
    category: "structured_output",
    difficulty: "hard",
    language: "en",
    task: "quality_check",
    input:
      "Check alignment across the full research chain: does each later section actually follow from and support the earlier ones? Return issues only.\n\n## Title\nDietary diversity and anaemia among pregnant women\n\n## Objectives\n1. Determine the proportion meeting minimum dietary diversity. 2. Determine anaemia prevalence. 3. Determine the effect of dietary diversity on birth weight.\n\n## Methodology\nCross-sectional survey; 24-hour recall; haemoglobin measurement at one antenatal visit.\n\n## Instrument\nMDD-W food group checklist; haemoglobin meter.",
    expected_behavior:
      "Returns schema-valid JSON flagging that objective 3 (birth weight, and a causal 'effect') is not supported by the methodology or instrument.",
    ground_truth: "Objective 3 is unmeasurable with the stated methods and is causal in a cross-sectional design.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      schema: "alignment",
      mustMention: [["birth weight"]],
    },
  },
];
