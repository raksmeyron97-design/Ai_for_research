import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

/**
 * Research questions previously reused the objectives prompt, which asked for
 * objectives (Phase 16 audit, D7). They are different artefacts: an objective
 * states what the study will do, a question states what it will answer, and
 * the mapping between them is what a supervisor checks.
 */
export function buildResearchQuestionsSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: draft research questions from the approved objectives.
Rules:
- One question per specific objective, phrased as an answerable question — not the objective with a question mark added.
- Match the question form to the study design in context. For a descriptive or cross-sectional design ask "what is" or "is there an association between"; never ask "does X cause Y", which no such design can answer.
- For each question, name the objective it answers and the variable it measures.
- Report every mismatch you find: an objective with no question, a question with no objective, and any two questions that ask the same thing.`;
}
