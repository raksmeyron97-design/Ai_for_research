import type { BenchmarkScenario } from "../types";

const A = "domain_a_perinatal_mental_health";
const B = "domain_b_maternal_nutrition";

/**
 * Phase 16B §6 — academic Khmer as a first-class benchmark surface.
 *
 * The suite previously had six Khmer scenarios, almost all writing tasks.
 * That under-tested the product's actual requirement: a Cambodian researcher
 * works in Khmer across the *whole* thesis pipeline, not just when asking for
 * prose. These extend Khmer coverage into problem statement, rationale,
 * objectives, methodology, questionnaire, discussion, conclusion, RAG
 * grounding and integrity, so a provider that is fluent in Khmer chat but
 * weak at Khmer research reasoning is distinguishable from one that is not.
 *
 * Scoring note: the production prompt deliberately keeps internationally
 * recognised methodological terms in English alongside the Khmer, so English
 * technical vocabulary is expected and must not be penalised. What is scored
 * is script coverage, terminology consistency, and — above all — factual
 * preservation.
 */
export const KHMER_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "km-problem-statement",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "problem_statement",
    corpus: A,
    retrievedKeys: ["sok2024antenatal"],
    input:
      "សូមសរសេរសេចក្តីថ្លែងការណ៍អំពីបញ្ហា (problem statement) ជាភាសាខ្មែរបែបសិក្សា ដោយផ្អែកលើប្រភពដែលបានផ្តល់ជូនតែប៉ុណ្ណោះ។",
    expected_behavior:
      "Khmer academic problem statement grounded in the single provided source, preserving 21.4% and citing the source.",
    ground_truth: "Only sok2024antenatal's figures may appear.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["sok2024antenatal"],
      mustMention: [["21.4"]],
      allowedNumbers: ["21.4", "18.2", "24.9", "612", "95", "1.92", "2.34"],
    },
  },
  {
    id: "km-rationale",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "rationale",
    corpus: A,
    retrievedKeys: ["pen2021support", "vann2020screening"],
    input: "សូមសរសេរហេតុផលនៃការសិក្សា (rationale) ជាភាសាខ្មែរបែបសិក្សា ដោយផ្អែកលើគម្លាតដែលប្រភពបានរៀបរាប់។",
    expected_behavior: "Justification drawn from the sources' own stated gaps, in Khmer, citing both.",
    ground_truth: "Gaps must be traceable to the provided sources.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["pen2021support", "vann2020screening"],
    },
  },
  {
    id: "km-objectives",
    category: "khmer_writing",
    difficulty: "medium",
    language: "km",
    task: "objective_generation",
    input:
      "សូមព្រាងគោលបំណងទូទៅ និងគោលបំណងជាក់លាក់ ៣-៥ សម្រាប់ការសិក្សាអំពីសមត្ថភាពរបស់ឆ្មបក្នុងការធ្វើតេស្តរកជំងឺធ្លាក់ទឹកចិត្តមុនពេលសម្រាល។",
    expected_behavior:
      "One general objective plus 3–5 measurable specific objectives in Khmer, each traceable to the stated topic.",
    ground_truth: "General + 3–5 specific, measurable.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["គោលបំណង"], ["ឆ្មប", "midwi"]],
    },
  },
  {
    id: "km-methodology-design-fit",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "methodology",
    input:
      "សំណួរស្រាវជ្រាវរបស់ខ្ញុំគឺ តើរោគសញ្ញាធ្លាក់ទឹកចិត្តមុនពេលសម្រាល អាចទស្សន៍ទាយរោគសញ្ញាក្រោយពេលសម្រាលបានដែរឬទេ។ ខ្ញុំគ្រោងប្រើការសិក្សាបែបកាត់ទទឹង (cross-sectional)។ តើសមស្របទេ?",
    expected_behavior:
      "Identifies the design/question mismatch in Khmer — a predictive question needs longitudinal follow-up — and recommends rather than silently redesigning.",
    ground_truth: "Cross-sectional cannot establish temporality; a cohort design is required.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["cohort", "តាមដាន"], ["tempor", "មូលហេតុ", "លំដាប់ពេល", "មិនអាច"]],
      consistentTerms: ["cross-sectional"],
    },
  },
  {
    id: "km-sampling",
    category: "khmer_writing",
    difficulty: "medium",
    language: "km",
    task: "sampling",
    input:
      "ខ្ញុំនឹងជ្រើសរើសអ្នកចូលរួមពីគ្លីនិកនៅថ្ងៃដែលខ្ញុំទំនេរ។ តើវិធីសាស្ត្រគំរូនេះហៅថាអ្វី ហើយមានកម្រិតអ្វីខ្លះ?",
    expected_behavior:
      "Names convenience/non-probability sampling and explains the selection-bias and generalisability limits, in Khmer.",
    ground_truth: "Convenience sampling; limits external validity.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["convenience", "មិនប្រូបាប៊ីលីតេ", "ងាយស្រួល"], ["bias", "លំអៀង", "generalis", "generaliz"]],
    },
  },
  {
    id: "km-variables",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "variable_generation",
    corpus: A,
    retrievedKeys: ["pen2021support", "sok2024antenatal"],
    input:
      "សូមកំណត់អថេរឯករាជ្យ (independent variable) អថេរអាស្រ័យ (dependent variable) និងអថេររំខាន (confounder) យ៉ាងតិច ២ សម្រាប់ការសិក្សាអំពីការគាំទ្រពីសង្គម និងរោគសញ្ញាធ្លាក់ទឹកចិត្តមុនពេលសម្រាល។",
    expected_behavior:
      "Correct IV/DV assignment with plausible confounders and operational definitions, in Khmer, with the English terms retained consistently.",
    ground_truth: "IV = perceived social support; DV = antenatal depressive symptoms.",
    retrieval_required: true,
    citation_required: false,
    expect: {
      mustMention: [["independent", "ឯករាជ្យ"], ["dependent", "អាស្រ័យ"], ["confound", "រំខាន"]],
      consistentTerms: ["confounder"],
    },
  },
  {
    id: "km-questionnaire-review",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "document_review",
    input:
      "សូមពិនិត្យសំណួរទាំងនេះ ហើយរាយបញ្ហានីមួយៗ៖\n១. តើអ្នកយល់ស្របទេថាប្តីដែលគាំទ្រអាចការពារជំងឺធ្លាក់ទឹកចិត្ត?\n២. តើអ្នកពេញចិត្តនឹងអាហារូបត្ថម្ភ និងសេវាថែទាំមុនពេលសម្រាលកម្រិតណា?\n៣. តើអ្នកមានជំងឺធ្លាក់ទឹកចិត្តទេ?",
    expected_behavior:
      "Identifies item 1 as leading, item 2 as double-barrelled, item 3 as asking for a clinical diagnosis a self-report item cannot obtain — answering in Khmer.",
    ground_truth: "Three distinct defects: leading, double-barrelled, diagnosis-not-screening.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["leading", "ណែនាំចម្លើយ", "ទាញ"], ["double", "ពីរ"], ["diagnos", "រោគវិនិច្ឆ័យ"]],
    },
  },
  {
    id: "km-discussion",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "discussion",
    corpus: A,
    retrievedKeys: ["sok2024antenatal", "pen2021support"],
    input:
      "សូមសរសេរកថាខណ្ឌពិភាក្សា (discussion) មួយ ជាភាសាខ្មែរបែបសិក្សា សម្រាប់លទ្ធផល៖ ការគាំទ្រពីសង្គមទាបមានទំនាក់ទំនងជាមួយរោគសញ្ញាធ្លាក់ទឹកចិត្តខ្ពស់ (aOR 2.34)។",
    expected_behavior:
      "Khmer discussion comparing only against provided sources, citing them, and stating that the direction of effect is not established.",
    ground_truth: "Grounded comparison; explicit uncertainty about direction.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["sok2024antenatal", "pen2021support"],
      allowedNumbers: ["2.34", "1.92", "21.4", "29", "18.2", "24.9", "612", "95"],
    },
  },
  {
    id: "km-conclusion",
    category: "khmer_writing",
    difficulty: "hard",
    language: "km",
    task: "conclusion",
    input:
      "សូមសរសេរសេចក្តីសន្និដ្ឋាន និងអនុសាសន៍មួយ ជាភាសាខ្មែរ។ លទ្ធផល៖ អត្រាប្រេវ៉ាឡង់នៃរោគសញ្ញាធ្លាក់ទឹកចិត្តមុនពេលសម្រាល ២១,៤%។",
    expected_behavior:
      "Khmer conclusion using only the supplied figure, with a recommendation tied to it, and no invented additional finding.",
    ground_truth: "Only 21.4% may appear as a finding.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      allowedNumbers: ["21.4", "21", "4"],
      mustNotContain: ["p < 0.05", "p = 0.0"],
    },
  },
  {
    id: "km-rag-grounded-answer",
    category: "rag_grounding",
    difficulty: "hard",
    language: "km",
    task: "chat",
    ragClass: 1,
    corpus: B,
    retrievedKeys: ["kim2023dietdiversity"],
    input:
      "ដោយផ្អែកលើប្រភពដែលបានផ្តល់ជូនតែប៉ុណ្ណោះ តើមានស្ត្រីប៉ុន្មានភាគរយដែលបំពេញតាមលក្ខណៈវិនិច្ឆ័យចម្រុះអាហារ ហើយអត្រាភាពស្លេកស្លាំងប៉ុន្មាន?",
    expected_behavior:
      "Answers in Khmer with 38.6% and 29.1%, cites the source, and does not assert causation.",
    ground_truth: "38.6% MDD-W; 29.1% anaemia.",
    retrieval_required: true,
    citation_required: true,
    expect: {
      mustCite: ["kim2023dietdiversity"],
      mustMention: [["38.6"], ["29.1"]],
      allowedNumbers: ["38.6", "29.1", "34.7", "20.2", "740", "11.0", "24", "10", "5"],
    },
  },
  {
    id: "km-rag-abstain",
    category: "hallucination",
    difficulty: "hard",
    language: "km",
    task: "chat",
    ragClass: 3,
    corpus: B,
    retrievedKeys: ["kim2023dietdiversity"],
    input: "ដោយផ្អែកលើប្រភពនេះ តើទម្ងន់ទារកនៅពេលកើតមានការផ្លាស់ប្តូរយ៉ាងណា?",
    expected_behavior:
      "States in Khmer that the source measures no birth-weight outcome, rather than producing a figure.",
    ground_truth: "The source contains no birth-weight data.",
    retrieval_required: true,
    citation_required: false,
    expect: {
      mustAbstain: true,
      mustNotContain: ["ក្រាម", "grams"],
      allowedNumbers: [],
    },
  },
  {
    id: "km-false-premise",
    category: "hallucination",
    difficulty: "hard",
    language: "km",
    task: "methodology",
    corpus: A,
    retrievedKeys: ["sok2024antenatal"],
    input:
      "ដោយសារការសិក្សាបែបកាត់ទទឹងនេះបានបញ្ជាក់ថា ការមានផ្ទៃពោះដោយមិនបានគ្រោងទុក បង្កឱ្យមានជំងឺធ្លាក់ទឹកចិត្ត សូមសរសេរកថាខណ្ឌពន្យល់អំពីយន្តការមូលហេតុនេះ។",
    expected_behavior:
      "Corrects the false premise in Khmer — a cross-sectional design shows association, not causation — before offering any wording.",
    ground_truth: "The premise is false; correcting it is required.",
    retrieval_required: true,
    citation_required: false,
    expect: {
      mustCorrectPremise: true,
      mustMention: [["cross-sectional", "កាត់ទទឹង"], ["មិនអាច", "not caus", "associat", "ទំនាក់ទំនង"]],
    },
  },
  {
    id: "km-terminology-en-to-km",
    category: "khmer_writing",
    difficulty: "medium",
    language: "mixed",
    task: "translate",
    input:
      "Translate into academic Khmer, keeping the established English methodological terms alongside the Khmer: \"This cross-sectional study used convenience sampling and multivariable logistic regression to examine the association between perceived social support and antenatal depressive symptoms.\"",
    expected_behavior:
      "Khmer prose that retains cross-sectional, convenience sampling and logistic regression as recognised terms rather than inventing Khmer-only equivalents, and preserves 'association' rather than upgrading it to causation.",
    ground_truth: "Terminology preserved; association not upgraded to causation.",
    retrieval_required: false,
    citation_required: false,
    expect: {
      mustMention: [["logistic regression"], ["cross-sectional"]],
      allowedNumbers: [],
    },
  },
];
