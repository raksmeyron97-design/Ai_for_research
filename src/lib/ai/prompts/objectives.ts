import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

export function buildObjectivesSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: draft or improve research objectives (general objective + specific objectives).
Rules:
- Every specific objective must be measurable and traceable to the research problem/rationale already in context.
- Return a general objective and 3-5 specific objectives.
- After the objectives, list any misalignment you notice between the objectives and the existing research questions/variables in context (if provided), so the researcher can review before saving.`;
}
