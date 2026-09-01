import type { QuestionKind } from "../db/types";

/**
 * Structural classification of a research question (§6).
 *
 * This reads *grammar*, not merit. It answers "what shape is this question",
 * and the honest answer is often "I can't tell" — which is why `unclassified`
 * is a first-class result rather than a fallback to the most common kind.
 *
 * §6 is explicit about what this may not do: it must never say a question is
 * scientifically invalid. A shape is a hint about which checks apply — a causal
 * question with no intervention modelled is worth mentioning, a descriptive one
 * with no hypothesis is not — and nothing more than that.
 */
export interface QuestionClassification {
  kind: QuestionKind;
  /** The words that decided it, shown to the researcher who may disagree. */
  matched: string[];
  reason: string;
}

/**
 * Ordered most specific first. A question containing both "effect of" and
 * "relationship" is causal in shape: the stronger claim wins, because
 * classifying it as merely correlational would suppress the checks the
 * stronger claim needs.
 */
const PATTERNS: { kind: Exclude<QuestionKind, "unclassified">; cues: RegExp[] }[] = [
  {
    kind: "causal",
    cues: [
      /\beffects? of\b/i,
      /\bimpacts? of\b/i,
      /\binfluenc(?:e|es|ing) of\b/i,
      /\bcauses?\b/i,
      /\bleads? to\b/i,
      /\bresults? in\b/i,
      /\bintervention\b/i,
      /\bdoes .* (?:improve|reduce|increase|decrease|change)\b/i,
    ],
  },
  {
    kind: "comparative",
    cues: [
      /\bdifferen(?:ce|ces|t)\b/i,
      /\bcompared? (?:to|with)\b/i,
      /\bcomparison\b/i,
      /\bmore .* than\b/i,
      /\bversus\b|\bvs\.?\b/i,
      // Deliberately NOT a bare "between X and Y": that is the standard
      // phrasing of a correlational question too ("the relationship between
      // workload and burnout"), and matching it here would misclassify every
      // one of them as a comparison.
    ],
  },
  {
    kind: "correlational",
    cues: [
      /\brelationships? between\b/i,
      /\bassociat(?:ion|ed|es)\b/i,
      /\bcorrelat(?:ion|ed|es)\b/i,
      /\brelated to\b/i,
      /\bpredicts?\b/i,
      /\blinked to\b/i,
    ],
  },
  {
    kind: "descriptive",
    cues: [
      /^\s*what is the (?:level|extent|degree|prevalence|status|proportion)\b/i,
      /\bhow many\b/i,
      /\bhow often\b/i,
      /\bwhat (?:are|is) the characteristics\b/i,
      /\bto what extent\b/i,
      /\bprevalence\b/i,
    ],
  },
  {
    kind: "exploratory",
    cues: [
      /\bexplore\b/i,
      /\bhow do .* (?:experience|perceive|describe|understand)\b/i,
      /\bwhat (?:factors|barriers|challenges|themes)\b/i,
      /\bperceptions? of\b/i,
      /\blived experience\b/i,
    ],
  },
];

const KIND_REASON: Record<Exclude<QuestionKind, "unclassified">, string> = {
  causal: "Phrased as an effect of one thing on another.",
  comparative: "Phrased as a comparison between groups or conditions.",
  correlational: "Phrased as a relationship between variables.",
  descriptive: "Phrased as a description of level, extent or frequency.",
  exploratory: "Phrased as an open exploration rather than a specific relationship.",
};

export function classifyQuestion(text: string): QuestionClassification {
  const question = text.trim();
  if (!question) {
    return { kind: "unclassified", matched: [], reason: "The question is empty." };
  }

  for (const pattern of PATTERNS) {
    const matched = pattern.cues
      .map((cue) => question.match(cue)?.[0])
      .filter((m): m is string => Boolean(m));

    if (matched.length > 0) {
      return { kind: pattern.kind, matched, reason: KIND_REASON[pattern.kind] };
    }
  }

  return {
    kind: "unclassified",
    matched: [],
    // Said as a limit of the rules, not a criticism of the question — §6.
    reason:
      "None of the structural patterns matched. That is a limit of this check, not a judgement on the question.",
  };
}

/**
 * Which structural checks a question's shape makes relevant. Used to decide
 * whether the absence of something is worth mentioning: a descriptive question
 * with no hypothesis is normal, a causal one with no hypothesis is a gap worth
 * naming.
 */
export function expectsHypothesis(kind: QuestionKind): boolean {
  return kind === "causal" || kind === "comparative" || kind === "correlational";
}
