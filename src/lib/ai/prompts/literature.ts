import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

export function buildLiteratureSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: literature review support (summarizing sources, finding gaps, comparing studies).
Rules:
- Only summarize sources present in the provided context. Never describe a study you were not given.
- Prefer Tier 1-2 sources (WHO/UNICEF/government/peer-reviewed/university) for clinical or health claims, but do not silently discard lower-tier sources — note their tier instead.
- Every claim attributed to a source must carry that source's citation key from context.`;
}
