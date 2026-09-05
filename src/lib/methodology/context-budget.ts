/**
 * The context budget contract (§18).
 *
 * Every methodology AI workflow declares what it sends, how much of it, and
 * what happens when the input is longer than the budget. The rule that matters
 * is the last one: **truncation is never silent.** A model shown half a
 * construct definition can produce a confident mapping for the half it saw, and
 * a researcher who was not told the text was cut has no way to know that is
 * what happened.
 *
 * These are deliberately small. §17's point is that a questionnaire item is
 * mapped by looking at the item and the candidate constructs — sending the
 * thesis, the source library and the other 30 items costs tokens to make the
 * answer worse, by giving the model other things to map.
 */
export interface ContextBudget {
  /** Longest single free-text field sent (item wording, statement, definition). */
  maxTextChars: number;
  /** How many candidate objects may be offered for the model to choose among. */
  maxCandidates: number;
  /** Longest candidate label. */
  maxCandidateChars: number;
  /** Cap on proposals accepted back, before validation. */
  maxProposals: number;
}

export const BUDGETS = {
  /** Map one item to a construct/indicator: the item plus the candidate list. */
  itemMapping: { maxTextChars: 600, maxCandidates: 40, maxCandidateChars: 120, maxProposals: 5 },
  /** Propose constructs from one research question. */
  constructSuggestion: { maxTextChars: 600, maxCandidates: 40, maxCandidateChars: 120, maxProposals: 8 },
  /** Propose hypotheses from one question and its constructs. */
  hypothesisSuggestion: { maxTextChars: 800, maxCandidates: 30, maxCandidateChars: 120, maxProposals: 6 },
  /** Draft items for one indicator. */
  itemGeneration: { maxTextChars: 800, maxCandidates: 12, maxCandidateChars: 200, maxProposals: 8 },
  /** Rewrite one item for neutrality/readability. */
  itemRewrite: { maxTextChars: 600, maxCandidates: 0, maxCandidateChars: 0, maxProposals: 3 },
  /** Propose operational-definition wording for one construct. */
  operationalDefinition: { maxTextChars: 900, maxCandidates: 20, maxCandidateChars: 160, maxProposals: 3 },
} as const satisfies Record<string, ContextBudget>;

export interface Truncated {
  text: string;
  truncated: boolean;
}

/**
 * Cuts on a word boundary and marks it. The marker is in the prompt as well as
 * in the return value: the model should know it is reading a fragment, because
 * a model that thinks it has the whole definition will answer as if it does.
 */
export function fitText(text: string, max: number): Truncated {
  const trimmed = text.trim();
  if (trimmed.length <= max) return { text: trimmed, truncated: false };

  const cut = trimmed.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return {
    text: `${boundary > max * 0.6 ? cut.slice(0, boundary) : cut}… [truncated]`,
    truncated: true,
  };
}

export interface Candidate {
  id: string;
  label: string;
  /** Extra qualifier shown to the model — a construct's role, an indicator's parent. */
  detail?: string;
}

export interface FittedCandidates {
  candidates: Candidate[];
  truncated: boolean;
}

export function fitCandidates(candidates: Candidate[], budget: ContextBudget): FittedCandidates {
  const kept = candidates.slice(0, budget.maxCandidates).map((candidate) => ({
    ...candidate,
    label: fitText(candidate.label, budget.maxCandidateChars).text,
  }));
  return { candidates: kept, truncated: kept.length < candidates.length };
}

/** Rendered for the prompt. Ids are opaque tokens the model must echo back verbatim. */
export function renderCandidates(candidates: Candidate[]): string {
  if (candidates.length === 0) return "(none)";
  return candidates
    .map((c) => `- id=${c.id} | ${c.label}${c.detail ? ` | ${c.detail}` : ""}`)
    .join("\n");
}
