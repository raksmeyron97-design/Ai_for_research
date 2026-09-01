import type { BenchmarkScenario } from "../types";

const A = "domain_a_perinatal_mental_health";
const B = "domain_b_maternal_nutrition";

/**
 * Khmer (Step 11) and English (Step 12) academic writing.
 *
 * Khmer scenarios are scored on script coverage, English leakage,
 * terminology consistency and — most importantly — factual preservation:
 * a fluent Khmer paragraph that changed a number or dropped a hedge fails,
 * because the failure mode this project actually cares about is meaning
 * loss in translation, not grammar.
 */
export const LANGUAGE_SCENARIOS: BenchmarkScenario[] = [
  // ------------------------------------------------------------- Khmer
  {
    id: "km-explain-concept",
    category: "khmer_writing",
    difficulty: "medium",
    language: "km",
    task: "chat",
    input:
      "សូមពន្យល់ជាភាសាខ្មែរបែបសិក្សា អំពីភាពខុសគ្នារវាង ការសិក្សាបែបកាត់ទទឹង (cross-sectional study) និង ការសិក្សាតាមដានជាបន្តបន្ទាប់ (cohort study) និងហេតុអ្វីបានជាការសិក្សាបែបកាត់ទទឹងមិនអាចបញ្ជាក់ពីមូលហេតុបាន។",
    expected_behavior:
      "Answers in Khmer academic register, keeps the English methodological terms alongside the Khmer, and correctly states that cross-sectional designs measure exposure and outcome at one point so temporality cannot be established.",
    ground_truth: "Cross-sectional = single timepoint, no temporality; cohort = follow-up over time.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["cross-sectional", "កាត់ទទឹង"], ["cohort", "តាមដាន"]],
      consistentTerms: ["cross-sectional", "cohort"],
    },
  },
  {
    id: "km-translate-en-to-km",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "translate",
    corpus: A,
    retrievedKeys: ["sok2024antenatal"],
    input:
      "Translate this into academic Khmer, preserving every number and hedge exactly: \"In this cross-sectional sample, the prevalence of probable antenatal depression was 21.4% (95% CI 18.2-24.9). Because the design is cross-sectional, these associations cannot establish that unplanned pregnancy causes depressive symptoms.\"",
    expected_behavior:
      "Produces Khmer prose that preserves 21.4%, the confidence interval, the word 'probable', and the explicit no-causation hedge.",
    ground_truth: "All numbers preserved; 'probable' preserved; causal hedge preserved.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["21.4"], ["18.2"], ["24.9"]],
      allowedNumbers: ["21.4", "18.2", "24.9", "95"],
    },
  },
  {
    id: "km-rewrite-academic",
    category: "khmer_writing",
    difficulty: "medium",
    language: "km",
    task: "rewrite",
    input:
      "សូមកែសម្រួលកថាខណ្ឌនេះឱ្យទៅជាភាសាខ្មែរបែបសិក្សា ដោយរក្សាអត្ថន័យដដែល៖ «ខ្ញុំចង់ដឹងថាតើស្ត្រីមានផ្ទៃពោះនៅស្រុកខ្ញុំមានជំងឺធ្លាក់ទឹកចិត្តច្រើនប៉ុណ្ណា ព្រោះខ្ញុំឃើញគេនិយាយថាមានច្រើន។»",
    expected_behavior:
      "Rewrites in academic Khmer register without adding any prevalence figure or claim the original did not contain.",
    ground_truth: "Register change only; no new facts, no invented statistics.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      allowedNumbers: [],
      maxWords: 250,
    },
  },
  {
    id: "km-abstract",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "summarize",
    corpus: B,
    retrievedKeys: ["kim2023dietdiversity"],
    input:
      "សរសេរសង្ខេប (abstract) ជាភាសាខ្មែរបែបសិក្សា ដោយផ្អែកលើប្រភពដែលបានផ្តល់ជូនតែប៉ុណ្ណោះ។ រក្សាតួលេខទាំងអស់ឱ្យត្រឹមត្រូវ។",
    expected_behavior:
      "Khmer abstract using only the provided source's figures (38.6%, 29.1%), citing it, with no invented conclusion.",
    ground_truth: "Only 38.6/29.1/34.7/20.2/740 may appear; no causal conclusion.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["kim2023dietdiversity"],
      allowedNumbers: ["38.6", "29.1", "34.7", "20.2", "740", "11.0", "24", "10", "5"],
    },
  },
  {
    id: "km-methodology-explain",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "methodology",
    input:
      "សូមពន្យល់ជាភាសាខ្មែរ អំពីអ្វីទៅជា confounding variable និងវិធីគ្រប់គ្រងវានៅក្នុងការវិភាគ ដោយប្រើពាក្យបច្ចេកទេសឱ្យស្ថិតស្ថេរ។",
    expected_behavior:
      "Explains confounding in Khmer with the English term retained and used consistently, and names at least one control strategy (restriction, matching, stratification, multivariable adjustment).",
    ground_truth: "Confounder definition + at least one control strategy, terminology consistent.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["confound"], ["stratif", "adjust", "match", "restrict", "regression"]],
      consistentTerms: ["confounding"],
    },
  },
  {
    id: "km-to-en-academic",
    category: "khmer_writing",
    difficulty: "medium",
    language: "mixed",
    task: "translate",
    input:
      "បកប្រែកថាខណ្ឌនេះទៅជាភាសាអង់គ្លេសបែបសិក្សា៖ «ការសិក្សានេះមានគោលបំណងពិពណ៌នាអំពីអត្រាប្រេវ៉ាឡង់នៃរោគសញ្ញាធ្លាក់ទឹកចិត្តក្នុងចំណោមស្ត្រីមានផ្ទៃពោះ ហើយពិនិត្យទំនាក់ទំនងជាមួយការគាំទ្រពីសង្គម។ ការសិក្សានេះមិនអាចបញ្ជាក់ពីមូលហេតុបានទេ។»",
    expected_behavior:
      "Produces English academic prose that keeps the objective structure and preserves the explicit statement that causation cannot be established.",
    ground_truth: "Objective + association + explicit no-causation statement, all preserved.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["prevalence"], ["social support"], ["caus"]],
      allowedNumbers: [],
    },
  },
  {
    id: "km-terminology-consistency",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "literature_review",
    corpus: A,
    retrievedKeys: ["chea2022anxiety"],
    input:
      "សរសេរកថាខណ្ឌពិនិត្យអក្សរសិល្ប៍ជាភាសាខ្មែរ អំពីភាពខុសគ្នារវាង pregnancy-specific anxiety និង generalised anxiety ដោយផ្អែកលើប្រភពដែលបានផ្តល់ ហើយប្រើពាក្យបច្ចេកទេសដដែលពេញកថាខណ្ឌ។",
    expected_behavior:
      "Khmer literature paragraph grounded in the single provided source, citing it, with both technical terms rendered identically each time they appear.",
    ground_truth: "Grounded in chea2022anxiety only; consistent terminology; r = 0.48 if any figure is used.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["chea2022anxiety"],
      consistentTerms: ["pregnancy-specific anxiety", "generalised anxiety"],
      allowedNumbers: ["0.48", "455"],
    },
  },

  // ------------------------------------------------------------- English
  {
    id: "en-rewrite-concise",
    category: "english_writing",
    difficulty: "easy",
    language: "en",
    task: "rewrite",
    input:
      "Rewrite this in concise academic English without changing its meaning: \"It is very important to note that the thing that this study is trying to do is basically to find out how many pregnant women have depression symptoms and also to see if there is any kind of relationship with how much support they feel like they are getting from people around them.\"",
    expected_behavior:
      "Produces one or two clean academic sentences preserving both aims, without adding a finding or a number.",
    ground_truth: "Two aims preserved; no new content; substantially shorter than the input.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["prevalence", "proportion", "how many", "frequency"], ["support"]],
      allowedNumbers: [],
      maxWords: 80,
    },
  },
  {
    id: "en-abstract-from-source",
    category: "english_writing",
    difficulty: "hard",
    language: "en",
    task: "summarize",
    corpus: A,
    retrievedKeys: ["meas2023postpartum"],
    input: "Write a structured abstract (Background, Methods, Results, Conclusion) using only the provided source.",
    expected_behavior:
      "All four headings present, figures exactly as in the source, and a conclusion that does not overstate beyond a cohort association.",
    ground_truth: "17.9/12.3/9.8/388/14% only; conclusion must not claim causation or effectiveness.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["meas2023postpartum"],
      mustMention: [["background"], ["method"], ["result"], ["conclusion"]],
      allowedNumbers: ["17.9", "12.3", "9.8", "388", "14", "36", "6", "3"],
    },
  },
  {
    id: "en-thesis-outline",
    category: "thesis_outline",
    difficulty: "medium",
    language: "en",
    task: "outline",
    input:
      "Produce a thesis outline for: 'Perceived social support and antenatal depressive symptoms among pregnant women attending urban health centres: a cross-sectional study.' Show the chapter structure and what each chapter must contain.",
    expected_behavior:
      "Produces the standard chapter chain (Introduction, Literature Review, Methodology, Results, Discussion, Conclusion) with content that stays consistent with a cross-sectional design.",
    ground_truth: "Standard chapters present; no longitudinal/interventional content smuggled into a cross-sectional study.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["introduction"], ["literature review"], ["method"], ["results"], ["discussion"], ["conclusion"]],
      mustNotContain: ["randomised controlled trial", "intervention group", "follow-up at 6 months"],
    },
  },
  {
    id: "en-summarize-tight",
    category: "summarization",
    difficulty: "easy",
    language: "en",
    task: "summarize",
    corpus: B,
    retrievedKeys: ["ung2022supplement"],
    input: "Summarise the provided source in no more than 60 words, preserving its main limitation.",
    expected_behavior: "Under 60 words, keeps 44.8% and the recall/social-desirability limitation, cites the source.",
    ground_truth: "44.8% adherence + recall bias limitation, in <= 60 words.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["ung2022supplement"],
      mustMention: [["recall", "self-report", "bias"]],
      maxWords: 90,
      allowedNumbers: ["44.8", "90", "520"],
    },
  },
  {
    id: "en-discussion-paragraph",
    category: "english_writing",
    difficulty: "hard",
    language: "en",
    task: "discussion",
    corpus: A,
    retrievedKeys: ["sok2024antenatal", "pen2021support"],
    input:
      "Write one discussion paragraph interpreting this finding: perceived social support was inversely associated with antenatal depressive symptoms (aOR 2.34 for low support). Compare with the provided literature.",
    expected_behavior:
      "Follows result -> interpretation -> comparison -> implication, compares only against the provided sources, cites them, and states the direction of effect is not established.",
    ground_truth: "Grounded comparison to pen2021support and sok2024antenatal only; explicit uncertainty about direction.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["sok2024antenatal", "pen2021support"],
      mustMention: [["direction", "causal", "cannot", "uncertain"]],
      allowedNumbers: ["2.34", "1.92", "21.4", "29", "18.2", "24.9", "612", "95"],
      maxWords: 400,
    },
  },
];
