import type { BenchmarkScenario } from "../types";

const A = "domain_a_perinatal_mental_health";
const B = "domain_b_maternal_nutrition";

/**
 * Methodology reasoning (Step 9). Scored on logical consistency, correct
 * terminology, explicit assumptions and appropriate hedging — never on
 * length. Each scenario has a concrete methodological fact that a correct
 * answer must get right, so verbosity alone cannot pass.
 */
export const METHODOLOGY_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "meth-design-fit",
    category: "methodology_reasoning",
    difficulty: "medium",
    language: "en",
    task: "methodology",
    input:
      "My research question is whether antenatal depressive symptoms predict postpartum depressive symptoms at six weeks. I planned a cross-sectional survey at the 6-week postpartum visit. Is that design appropriate?",
    expected_behavior:
      "Identifies that a predictive/temporal question requires a longitudinal (prospective cohort) design, that cross-sectional measurement at 6 weeks cannot establish antecedence, and presents this as a recommendation with tradeoffs rather than silently changing the design.",
    ground_truth: "Design-question mismatch: prediction over time needs prospective follow-up, not a single postpartum cross-section.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["cohort", "longitudinal", "prospective"], ["tempor", "antecede", "before", "over time"], ["recall bias", "recommend", "consider", "trade"]],
      maxWords: 600,
    },
  },
  {
    id: "meth-variables",
    category: "methodology_reasoning",
    difficulty: "medium",
    language: "en",
    task: "variable_generation",
    corpus: A,
    retrievedKeys: ["sok2024antenatal", "pen2021support"],
    input:
      "For a study of perceived social support and antenatal depressive symptoms, identify the independent variable, dependent variable, and at least two plausible confounders, with operational definitions.",
    expected_behavior:
      "Correctly assigns IV (perceived social support) and DV (antenatal depressive symptoms), names plausible confounders (e.g. unplanned pregnancy, parity, income), and gives measurable operational definitions.",
    ground_truth: "IV = perceived social support; DV = antenatal depressive symptom score; confounders must plausibly relate to both.",
    retrieval_required: true,
    citation_required: false,
    expect: {
      mustMention: [["independent"], ["dependent"], ["confound"], ["operational", "measured", "defined as"]],
    },
  },
  {
    id: "meth-confounder-vs-mediator",
    category: "methodology_reasoning",
    difficulty: "hard",
    language: "en",
    task: "methodology",
    input:
      "In a study of unplanned pregnancy and antenatal depression, is perceived partner support a confounder or a mediator? Explain how the choice changes my analysis.",
    expected_behavior:
      "Explains that the classification depends on the assumed causal ordering, that adjusting for a mediator attenuates the total effect, and states the assumption explicitly rather than asserting one answer.",
    ground_truth: "Depends on causal position; adjusting for a mediator biases the total-effect estimate.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["mediat"], ["confound"], ["assum", "depends", "causal order", "temporal order"], ["adjust", "control for"]],
    },
  },
  {
    id: "meth-sample-size",
    category: "methodology_reasoning",
    difficulty: "hard",
    language: "en",
    task: "sample_size",
    input:
      "How many participants do I need for a cross-sectional study estimating the prevalence of antenatal depression in one province?",
    expected_behavior:
      "Names the inputs a prevalence sample-size calculation requires (expected prevalence, margin of error, confidence level, design effect, non-response) and does not present a single number as final without those assumptions.",
    ground_truth: "A number is meaningless without stated assumptions; the correct answer surfaces the required parameters.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["prevalence", "expected proportion"], ["margin of error", "precision", "confidence"], ["non-response", "design effect", "attrition"]],
    },
  },
  {
    id: "meth-sampling-strategy",
    category: "methodology_reasoning",
    difficulty: "medium",
    language: "en",
    task: "sampling",
    input:
      "I will recruit pregnant women from the antenatal clinic on the days I am free. What is this sampling method called and what does it limit?",
    expected_behavior:
      "Names it convenience (non-probability) sampling and explains the limit on generalisability and the selection bias it introduces.",
    ground_truth: "Convenience/non-probability sampling; limits external validity and introduces selection bias.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["convenience", "non-probability", "nonprobability"], ["selection bias", "generalis", "generaliz", "external validity"]],
      maxWords: 400,
    },
  },
  {
    id: "meth-measurement-bias",
    category: "methodology_reasoning",
    difficulty: "hard",
    language: "en",
    task: "methodology",
    corpus: B,
    retrievedKeys: ["ung2022supplement", "hor2021gwg"],
    input:
      "I will ask postpartum women to recall their iron supplement adherence and their pre-pregnancy weight. What measurement problems should my limitations section name?",
    expected_behavior:
      "Names recall bias and social-desirability bias for adherence, and the downward bias from substituting first-trimester weight for pre-pregnancy weight, citing the provided sources.",
    ground_truth: "Recall + social desirability bias; substituted first-trimester weight biases gestational weight gain.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["ung2022supplement", "hor2021gwg"],
      mustMention: [["recall bias", "recall"], ["social desirability", "social-desirability"], ["pre-pregnancy weight", "first-trimester", "first trimester"]],
    },
  },
  {
    id: "meth-analysis-plan",
    category: "methodology_reasoning",
    difficulty: "medium",
    language: "en",
    task: "methodology",
    input:
      "My outcome is a binary screening result (probable depression yes/no) and my main exposure is a continuous support score, with three categorical covariates. What analysis should I plan?",
    expected_behavior:
      "Proposes logistic regression as the appropriate model for a binary outcome, and states the recommendation is conditional on distribution, events-per-variable and assumption checks rather than final.",
    ground_truth: "Binary outcome + continuous exposure + covariates => multivariable logistic regression, conditional on assumptions.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["logistic regression"], ["assumption", "depends", "events per variable", "check"]],
    },
  },
  {
    id: "meth-ethics",
    category: "methodology_reasoning",
    difficulty: "medium",
    language: "en",
    task: "methodology",
    input:
      "What ethical considerations should my protocol address for screening pregnant women for depressive symptoms?",
    expected_behavior:
      "Names informed consent, confidentiality, ethics committee approval as something the researcher must obtain (not something the AI can assert exists), and a referral pathway for participants who screen positive.",
    ground_truth: "Consent, confidentiality, IRB/ethics approval to be obtained, and a referral pathway for positive screens.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["informed consent"], ["confidential"], ["ethic", "IRB", "review board", "committee"], ["referral", "follow-up care", "support pathway"]],
      mustNotContain: ["ethics approval was obtained", "IRB approval was granted"],
    },
  },
];
