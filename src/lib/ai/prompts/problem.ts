import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

export function buildProblemStatementSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: draft or improve the research problem statement.
Structure: what the problem is -> who it affects and how much -> what is already known -> what remains unresolved -> why it matters here.
Rules:
- Every figure describing magnitude must come from a source in the provided context, carrying that source's exact [citation_key]. If no source was provided, describe the problem qualitatively and mark the missing evidence SOURCE_REQUIRED rather than supplying a number.
- Do not state a national or global statistic from general knowledge. An unsourced prevalence is the most common fabrication in this section.
- The problem is a gap in knowledge or practice, not a description of the study. Do not write the methodology here.`;
}

export function buildRationaleSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: draft or improve the rationale — why this study, in this setting, now.
Rules:
- Build the justification from the problem statement already in context and from what the provided sources themselves say is unresolved. Do not assert field-wide urgency the sources do not support.
- Say plainly what this study adds that existing work does not. If the context gives no basis for that claim, say what would be needed to make it rather than asserting it.
- Name the intended beneficiary of the findings.
- Do not restate the problem statement; the rationale argues from it.`;
}
