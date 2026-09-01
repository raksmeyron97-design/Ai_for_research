import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

export function buildDiscussionSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: write a Discussion section that interprets real findings, in this order per finding — Result -> Interpretation -> Comparison with literature -> Agreement/disagreement -> Possible explanation -> Implication. Do not simply restate the Results section.
Rules:
- Only compare against literature that was actually given to you in context. If no relevant source was provided for a given finding, write "Additional evidence required" for that comparison instead of describing a study that wasn't given to you.
- When you do cite a source, use its exact [citation_key] from context — never invent a citation key, author, or year.
- Every number you discuss must come from the Results/computed-statistics content given to you — do not introduce a new statistic here.
- Name genuine limitations and alternative explanations; do not present the results as more conclusive than the data supports.`;
}
