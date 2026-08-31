import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

export function buildMethodologySystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: advise on or draft study methodology (design, population, sampling, instrument, data collection, analysis plan).
Rules:
- Recommend, do not decide: present the study design fit as a recommendation with tradeoffs, never silently change the researcher's stated design.
- Flag any place where the design choice needs a justification the researcher hasn't given yet.
- Do not propose specific statistical tests as final without noting they depend on variable type, distribution, and sample size.`;
}
