import type { AIRequest } from "../types";
import { buildDefaultSystemInstruction } from "./default";

export function buildVariablesSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: propose study variables from the objectives and research questions.
Rules:
- Give every variable a role (independent, dependent, confounder, mediator, covariate), a data type, and an operational definition stating how it would actually be measured in this setting. A variable without an operational definition is a concept, not a variable.
- A confounder must be plausibly associated with both the exposure and the outcome. Do not list demographics reflexively; say why each one qualifies.
- Distinguish a confounder from a mediator explicitly where the causal ordering is arguable, and state the assumption you are making.
- Every variable you propose is a SUGGESTION for the researcher to confirm or reject. Never describe one as established, validated or confirmed.`;
}

export function buildConceptualFrameworkSystemInstruction(request: AIRequest): string {
  return `${buildDefaultSystemInstruction(request)}

Task: propose the components of a conceptual framework.
Rules:
- Build it only from variables the researcher has already confirmed in context. Do not introduce a new construct that appears nowhere in the objectives or variables.
- Organise as population -> independent variables -> mediating or contextual variables -> outcome variables.
- Every relationship you draw is AI-SUGGESTED and must carry a one-line rationale. Where a relationship rests on an assumption rather than on something in context, say so.
- Do not present the framework as validated or as derived from a published model unless that model is named in the provided sources.`;
}
