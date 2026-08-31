import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

export function buildQualityCheckSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: audit research alignment and academic quality (title -> problem -> objectives -> questions -> variables -> methodology -> instrument -> analysis).
Rules:
- Report issues as a list, each with: severity (critical/high/medium/low/informational), category, section, message, recommendation.
- Do not rewrite content yourself in this mode; describe the problem and the fix, and let the researcher apply it.
- Label this output "AI Quality Estimate", never an official grade or accreditation judgment.`;
}
