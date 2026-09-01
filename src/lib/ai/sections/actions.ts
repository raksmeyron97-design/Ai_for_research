import type { SectionType } from "../../db/types";
import type { TaskType } from "../types";

/**
 * The contextual AI actions each section offers.
 *
 * §4's rule is "only expose actions that make sense for the current
 * section", so this is a per-section allowlist rather than a global toolbar.
 * The point is not to hide capability — it is that an action which cannot
 * work for a section is worse than no action: it invites a request the
 * pipeline will refuse or answer badly, and the researcher has no way to
 * know that in advance.
 *
 * `generate` is absent from sections whose content must come from a
 * dedicated generator with its own guards (results, discussion, conclusion,
 * questionnaire): those route to the existing generator endpoints instead,
 * so this registry never becomes a second way to produce the same content.
 */
export type SectionActionId =
  | "generate"
  | "improve"
  | "rewrite"
  | "explain"
  | "review"
  | "check_alignment"
  | "add_evidence"
  | "shorten"
  | "expand"
  | "translate";

export interface SectionAction {
  id: SectionActionId;
  label: string;
  /** One line the UI shows so a student knows what it will do. */
  description: string;
  /** Production TaskType this action routes to — decides tier, prompt and provider. */
  task: TaskType;
  /** Requires text already in the section. */
  requiresContent: boolean;
  /** Surfaced first in the UI; everything else lives behind "More" (§25). */
  primary?: boolean;
}

const IMPROVE: SectionAction = {
  id: "improve",
  label: "Improve",
  description: "Tighten the academic style without changing what it says.",
  task: "rewrite",
  requiresContent: true,
  primary: true,
};

const REWRITE: SectionAction = {
  id: "rewrite",
  label: "Rewrite",
  description: "Rewrite this section in academic register, preserving every factual claim.",
  task: "rewrite",
  requiresContent: true,
};

const EXPLAIN: SectionAction = {
  id: "explain",
  label: "Explain",
  description: "Explain what this section needs to contain and why.",
  task: "chat",
  requiresContent: false,
};

const SHORTEN: SectionAction = {
  id: "shorten",
  label: "Shorten",
  description: "Reduce length while keeping every claim and hedge.",
  task: "summarize",
  requiresContent: true,
};

const EXPAND: SectionAction = {
  id: "expand",
  label: "Expand",
  description: "Develop the existing points further. Adds no new findings.",
  task: "rewrite",
  requiresContent: true,
};

const TRANSLATE: SectionAction = {
  id: "translate",
  label: "Translate",
  description: "Translate between Khmer and English, keeping technical terms.",
  task: "translate",
  requiresContent: true,
};

/**
 * Not primary. §25's own menu ordering is Generate, Improve, Review,
 * Evidence, Alignment, More — and a section offering Generate, Review,
 * Improve *and* Alignment up front is four buttons, which is the row this
 * design exists to avoid.
 */
const CHECK_ALIGNMENT: SectionAction = {
  id: "check_alignment",
  label: "Check alignment",
  description: "Check this section still follows from the sections before it.",
  task: "quality_check",
  requiresContent: true,
};

const ADD_EVIDENCE: SectionAction = {
  id: "add_evidence",
  label: "Add evidence",
  description: "Find saved sources that support the claims here.",
  task: "source_search",
  requiresContent: true,
};

function generate(task: TaskType, description: string): SectionAction {
  return { id: "generate", label: "Generate", description, task, requiresContent: false, primary: true };
}

function review(task: TaskType, description: string): SectionAction {
  return { id: "review", label: "Review", description, task, requiresContent: true, primary: true };
}

export const SECTION_ACTIONS: Record<SectionType, SectionAction[]> = {
  title: [
    generate("topic_generation", "Draft candidate titles from the project profile."),
    IMPROVE,
    EXPLAIN,
  ],
  research_problem: [
    generate("problem_statement", "Draft a problem statement: magnitude, gap, and why it matters."),
    IMPROVE,
    ADD_EVIDENCE,
    REWRITE,
    EXPAND,
    TRANSLATE,
    EXPLAIN,
  ],
  rationale: [
    generate("rationale", "Draft the justification for the study from the problem statement."),
    IMPROVE,
    ADD_EVIDENCE,
    CHECK_ALIGNMENT,
    REWRITE,
    SHORTEN,
    TRANSLATE,
    EXPLAIN,
  ],
  research_gap: [
    generate("research_gap", "Identify what the saved sources leave unanswered."),
    review("document_review", "Check the gap is supported by the sources, not asserted."),
    ADD_EVIDENCE,
    IMPROVE,
    TRANSLATE,
    EXPLAIN,
  ],
  objectives: [
    generate("objective_generation", "Draft a general objective and 3-5 specific objectives."),
    review("methodology_audit", "Check each objective is measurable and not duplicated."),
    CHECK_ALIGNMENT,
    IMPROVE,
    TRANSLATE,
    EXPLAIN,
  ],
  research_questions: [
    generate("research_question", "Draft one question per objective."),
    review("methodology_audit", "Check every objective has a question and vice versa."),
    CHECK_ALIGNMENT,
    IMPROVE,
    TRANSLATE,
    EXPLAIN,
  ],
  variables: [
    generate("variable_generation", "Suggest variables with types and operational definitions."),
    review("methodology_audit", "Check variables cover the objectives and are measurable."),
    CHECK_ALIGNMENT,
    EXPLAIN,
  ],
  conceptual_framework: [
    generate("conceptual_framework", "Propose framework components from your confirmed variables."),
    review("methodology_audit", "Check the framework matches the variables and design."),
    EXPLAIN,
  ],
  methodology: [
    generate("methodology", "Draft the methodology from your objectives and variables."),
    review("methodology_audit", "Structured review: design, population, sampling, instrument, analysis, ethics."),
    CHECK_ALIGNMENT,
    IMPROVE,
    TRANSLATE,
    EXPLAIN,
  ],
  questionnaire: [
    // Generation routes to the dedicated questionnaire generator, which
    // persists instrument and question rows — not to this registry.
    review("document_review", "Check items for leading, double-barrelled or ambiguous wording."),
    CHECK_ALIGNMENT,
    EXPLAIN,
  ],
  data_collection: [
    generate("methodology", "Draft the data collection procedure from the methodology."),
    review("methodology_audit", "Check the procedure matches the instrument and design."),
    IMPROVE,
    TRANSLATE,
    EXPLAIN,
  ],
  data_analysis: [
    generate("methodology", "Draft the analysis plan from your variables and objectives."),
    review("methodology_audit", "Check the planned tests suit the variable types."),
    CHECK_ALIGNMENT,
    EXPLAIN,
  ],
  results: [
    // No generate: results come from the dataset via generateResultsAnalysis.
    EXPLAIN,
    review("document_review", "Check the narrative matches the computed statistics."),
    IMPROVE,
    TRANSLATE,
  ],
  discussion: [
    // No generate: generateDiscussion enforces the results-exist guard.
    review("document_review", "Check for claims the results or sources do not support."),
    ADD_EVIDENCE,
    IMPROVE,
    SHORTEN,
    TRANSLATE,
    EXPLAIN,
  ],
  conclusion: [
    // No generate: generateConclusion enforces the objectives+findings guard.
    review("document_review", "Check nothing here is new — a conclusion adds no findings."),
    CHECK_ALIGNMENT,
    IMPROVE,
    SHORTEN,
    TRANSLATE,
  ],
  recommendations: [
    generate("conclusion", "Draft recommendations tied to specific findings."),
    review("document_review", "Check each recommendation names a finding and an actor."),
    IMPROVE,
    TRANSLATE,
    EXPLAIN,
  ],
  references: [
    review("reference_formatting", "Check reference formatting and completeness."),
    EXPLAIN,
  ],
  appendices: [EXPLAIN],
};

export function getSectionActions(section: SectionType): SectionAction[] {
  return SECTION_ACTIONS[section];
}

export function findSectionAction(section: SectionType, id: SectionActionId): SectionAction | undefined {
  return SECTION_ACTIONS[section].find((a) => a.id === id);
}

/** Actions shown up front; the rest go behind "More" (§25 progressive disclosure). */
export function primaryActions(section: SectionType): SectionAction[] {
  return SECTION_ACTIONS[section].filter((a) => a.primary);
}

export function secondaryActions(section: SectionType): SectionAction[] {
  return SECTION_ACTIONS[section].filter((a) => !a.primary);
}
