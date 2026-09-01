import type { SectionType } from "../../db/types";

/**
 * What each section's AI actions are allowed to see.
 *
 * Before this, `context-manager.ts` built the same five layers for every
 * request: a `title` request and a `discussion` request received structurally
 * identical context. That is a quality problem before it is a cost problem —
 * a model drafting objectives does not benefit from retrieved literature
 * chunks, it benefits from the problem statement it is supposed to follow
 * from — and it is also the token waste §20 is about.
 *
 * `excluded` is deliberately explicit rather than "everything not required".
 * Naming what must never be sent makes an accidental widening visible in a
 * diff, and gives the tests something to assert against.
 */
export type ContextLayer =
  /** Title, discipline, design, population, location, sample size. Cheap and almost always relevant. */
  | "projectProfile"
  /** The section being worked on. */
  | "currentSection"
  /** Named earlier sections this one must follow from. */
  | "priorSections"
  /** Vector-retrieved excerpts from uploaded documents. */
  | "retrievedSources"
  /** Saved `research_citations` rows. */
  | "citations"
  /** Computed dataset statistics — never raw rows. */
  | "datasetSummary"
  /** Recent conversation turns. */
  | "conversation";

export interface SectionContextPolicy {
  required: ContextLayer[];
  optional: ContextLayer[];
  excluded: ContextLayer[];
  /**
   * Sections whose content is fed in as `priorSections`. Ordered by the
   * research chain, and kept deliberately short: "everything before this
   * one" would reintroduce the problem this policy exists to solve.
   */
  priorSections: SectionType[];
  /**
   * Whether a vector search should run at all. Retrieval costs an embedding
   * call before it costs context tokens, so a section that cannot use
   * sources should not pay for one.
   */
  retrieval: boolean;
}

const NONE: SectionType[] = [];

/**
 * One policy per section in the authoritative 18-section chain.
 *
 * The general shape: early sections look upward at the framing that precedes
 * them, middle sections look at the design decisions they must stay
 * consistent with, and late sections look at real findings. Literature is
 * retrieved only where a claim needs a source; the dataset summary is
 * available only where numbers are legitimately discussed.
 */
export const SECTION_CONTEXT_POLICY: Record<SectionType, SectionContextPolicy> = {
  title: {
    required: ["projectProfile"],
    optional: ["currentSection"],
    excluded: ["retrievedSources", "citations", "datasetSummary", "conversation"],
    priorSections: NONE,
    retrieval: false,
  },
  research_problem: {
    required: ["projectProfile", "currentSection"],
    optional: ["retrievedSources", "citations"],
    excluded: ["datasetSummary", "conversation"],
    priorSections: ["title"],
    retrieval: true,
  },
  rationale: {
    required: ["projectProfile", "currentSection", "priorSections"],
    optional: ["retrievedSources", "citations"],
    excluded: ["datasetSummary", "conversation"],
    priorSections: ["title", "research_problem"],
    retrieval: true,
  },
  research_gap: {
    // The one section whose entire job is literature, so sources are required.
    required: ["projectProfile", "currentSection", "retrievedSources", "citations"],
    optional: ["priorSections"],
    excluded: ["datasetSummary", "conversation"],
    priorSections: ["research_problem", "rationale"],
    retrieval: true,
  },
  objectives: {
    // §5's worked example: objectives follow from the problem and rationale.
    // Literature does not make an objective measurable, so it is excluded
    // rather than merely optional.
    required: ["projectProfile", "currentSection", "priorSections"],
    optional: [],
    excluded: ["retrievedSources", "citations", "datasetSummary", "conversation"],
    priorSections: ["title", "research_problem", "rationale", "research_questions"],
    retrieval: false,
  },
  research_questions: {
    required: ["projectProfile", "currentSection", "priorSections"],
    optional: [],
    excluded: ["retrievedSources", "citations", "datasetSummary", "conversation"],
    priorSections: ["research_problem", "objectives", "variables"],
    retrieval: false,
  },
  variables: {
    required: ["projectProfile", "currentSection", "priorSections"],
    optional: [],
    excluded: ["retrievedSources", "datasetSummary", "conversation"],
    priorSections: ["objectives", "research_questions", "conceptual_framework"],
    retrieval: false,
  },
  conceptual_framework: {
    required: ["projectProfile", "currentSection", "priorSections"],
    optional: ["citations"],
    excluded: ["datasetSummary", "conversation"],
    priorSections: ["objectives", "variables"],
    retrieval: false,
  },
  methodology: {
    // §5's worked example, minus literature: a design review is judged
    // against the study's own objectives and variables, not against papers.
    required: ["projectProfile", "currentSection", "priorSections"],
    optional: [],
    excluded: ["retrievedSources", "datasetSummary", "conversation"],
    priorSections: ["objectives", "research_questions", "variables"],
    retrieval: false,
  },
  questionnaire: {
    required: ["projectProfile", "priorSections"],
    optional: ["currentSection", "citations"],
    excluded: ["retrievedSources", "datasetSummary", "conversation"],
    priorSections: ["objectives", "variables", "rationale"],
    retrieval: false,
  },
  data_collection: {
    required: ["projectProfile", "currentSection", "priorSections"],
    optional: [],
    excluded: ["retrievedSources", "datasetSummary", "conversation"],
    priorSections: ["methodology", "questionnaire"],
    retrieval: false,
  },
  data_analysis: {
    required: ["projectProfile", "currentSection", "priorSections"],
    optional: ["datasetSummary"],
    excluded: ["retrievedSources", "conversation"],
    priorSections: ["objectives", "variables", "methodology"],
    retrieval: false,
  },
  results: {
    // Dataset summary is REQUIRED, not optional: the orchestrator's dataset
    // guard blocks this section without one anyway, and computed statistics
    // are the only legitimate source of a number here.
    required: ["projectProfile", "priorSections", "datasetSummary"],
    optional: ["currentSection"],
    excluded: ["retrievedSources", "citations", "conversation"],
    priorSections: ["objectives", "research_questions", "data_analysis"],
    retrieval: false,
  },
  discussion: {
    // The one place literature and findings are both required — comparing
    // results against sources is the section's entire purpose.
    required: ["projectProfile", "priorSections", "citations"],
    optional: ["currentSection", "retrievedSources"],
    excluded: ["datasetSummary", "conversation"],
    priorSections: ["objectives", "results"],
    retrieval: true,
  },
  conclusion: {
    // No literature and no dataset: a conclusion synthesises what the thesis
    // already established. Anything new here is by definition unsupported.
    required: ["projectProfile", "priorSections"],
    optional: ["currentSection"],
    excluded: ["retrievedSources", "citations", "datasetSummary", "conversation"],
    priorSections: ["objectives", "results", "discussion"],
    retrieval: false,
  },
  recommendations: {
    required: ["projectProfile", "priorSections"],
    optional: ["currentSection"],
    excluded: ["retrievedSources", "datasetSummary", "conversation"],
    priorSections: ["objectives", "results", "conclusion"],
    retrieval: false,
  },
  references: {
    required: ["citations"],
    optional: ["currentSection"],
    excluded: ["retrievedSources", "datasetSummary", "conversation", "priorSections"],
    priorSections: NONE,
    retrieval: false,
  },
  appendices: {
    required: ["projectProfile"],
    optional: ["currentSection"],
    excluded: ["retrievedSources", "citations", "datasetSummary", "conversation"],
    priorSections: NONE,
    retrieval: false,
  },
};

export function getContextPolicy(section: SectionType): SectionContextPolicy {
  return SECTION_CONTEXT_POLICY[section];
}

/** True when the layer may be included for this section. */
export function allowsLayer(section: SectionType, layer: ContextLayer): boolean {
  const policy = SECTION_CONTEXT_POLICY[section];
  return policy.required.includes(layer) || policy.optional.includes(layer);
}
