import { buildSystemInstruction } from "@/lib/ai/prompt-manager";
import type { AIRequest } from "@/lib/ai/types";
import type { ContextFormat } from "../fixtures/context";
import type { Variant } from "../types";

/**
 * The A/B arms for Step 21. Exactly one thing changes between them, so a
 * measured difference is attributable to that thing:
 *
 *   A — production as shipped: `buildSystemInstruction()` verbatim, and
 *       retrieved excerpts rendered the way `context-manager.ts` renders
 *       them (numbered `[1]`, no citation key).
 *
 *   B — the same system instruction plus a short citation-contract
 *       addendum, with excerpts labelled by citation key.
 *
 * B is a candidate, not a recommendation. It changes production behaviour
 * only if the benchmark shows it wins; until then it exists solely inside
 * the harness.
 */
export const VARIANT_B_PROMPT_VERSION = "16.0.0-citation-contract";

const CITATION_CONTRACT_ADDENDUM = `
Citation contract for this response:
- Cite only using the exact bracketed key shown on each excerpt under "## Relevant Document Excerpts" (e.g. [smith2024topic]). Never renumber them and never invent a key.
- If a claim is not supported by one of those excerpts, either omit it or mark it UNVERIFIED — do not attach a citation to it.
- If the excerpts disagree with each other, report both and say they disagree; do not reconcile or average them.
- If the excerpts do not answer the question, say exactly that instead of answering from general knowledge.
`.trim();

export function systemInstructionFor(request: AIRequest, variant: Variant): string {
  const base = buildSystemInstruction(request);
  return variant === "A" ? base : `${base}\n\n${CITATION_CONTRACT_ADDENDUM}`;
}

export function contextFormatFor(variant: Variant): ContextFormat {
  return variant === "A" ? "production" : "keyed";
}
