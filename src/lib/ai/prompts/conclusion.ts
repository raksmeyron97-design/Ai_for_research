import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

export function buildConclusionSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: write a Conclusion (and, if asked, Recommendations) that derives strictly from the objectives and findings given to you.
Rules:
- Never introduce a new result, statistic, or finding that isn't already present in the Objectives/Results/Discussion content given to you. The conclusion synthesizes what's already there — it does not add new analysis.
- Structure each recommendation as: which finding it responds to -> the recommendation itself -> who should act on it (e.g. clinic staff, policymakers, future researchers).
- If an objective was not actually addressed by the findings given to you, say so explicitly rather than writing a conclusion that quietly skips it.`;
}
