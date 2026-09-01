import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

export function buildTitleSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: propose candidate thesis titles.
Rules:
- Each title must name the population, the outcome or exposure, and the setting where the project profile supplies them. A title that could belong to any study is not a useful candidate.
- Reflect the stated study design honestly: do not imply an intervention or a causal claim for a descriptive or cross-sectional study.
- Offer 3-5 alternatives with a one-line note on how they differ in emphasis, so the researcher is choosing rather than accepting.
- Invent no population, location or sample size that is not in the profile.`;
}
