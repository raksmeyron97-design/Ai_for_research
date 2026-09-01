import type { ResearchWarning } from "./types";

/**
 * A bounded, honest heuristic — same spirit as `detectUnsourcedNumbers`
 * (Phase 8): it catches an obvious, common phrasing of an instruction-
 * override attempt inside retrieved document/citation content, not every
 * way a document could try to manipulate a model. It never blocks
 * anything — the real defense is the system-instruction rule in
 * `research-integrity-guard.ts` telling the model to treat this content as
 * data regardless of what it says. This just makes a suspicious upload
 * visible to the researcher instead of silent, since a heuristic that
 * can't tell "a paper describing prompt-injection as a research topic"
 * from "an actual injection attempt" would be wrong to hard-block on.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier) instructions/i,
  /disregard (all |any |the )?(previous|prior|above|earlier) instructions/i,
  /\byou are now\b/i,
  /reveal (your|the) (system )?(instructions|prompt)/i,
  /what (is|are) your (system )?(instructions|prompt)/i,
  /act as (if you (are|were)|an?) (an? )?(unrestricted|jailbroken|dan\b)/i,
  /\bnew instructions?:/i,
  /\bsystem\s*:\s*you (must|will|should)\b/i,
];

/** Scans a block of untrusted (retrieved/context) text for instruction-override patterns. Returns null when nothing suspicious is found. */
export function detectPromptInjection(text: string): ResearchWarning | null {
  if (!text) return null;
  const hit = INJECTION_PATTERNS.some((pattern) => pattern.test(text));
  if (!hit) return null;

  return {
    severity: "high",
    category: "security",
    message:
      "Retrieved document or source content contains text resembling an instruction-override attempt (e.g. \"ignore previous instructions\"). The AI was told to treat this content as data only, but review the response and the source document.",
    recommendation: "Check the flagged source document for tampering and verify the AI's response didn't act on any embedded instructions.",
  };
}
