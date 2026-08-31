import { buildTaskSystemInstruction } from "./prompts";
import { RESEARCH_INTEGRITY_INSTRUCTIONS } from "./research-integrity-guard";
import type { AIRequest } from "./types";

/**
 * Combines the task-specific system prompt with the always-on integrity
 * guard, and assembles the final user-turn prompt from pre-built context
 * (ContextManager's job, Phase 2/3) plus the user's message.
 */
export function buildSystemInstruction(request: AIRequest): string {
  return `${buildTaskSystemInstruction(request)}\n\n${RESEARCH_INTEGRITY_INSTRUCTIONS}`;
}

export function buildPrompt(request: AIRequest): string {
  const parts: string[] = [];
  if (request.context) {
    parts.push(`# Research Context\n${request.context}`);
  }
  if (request.message) {
    parts.push(`# Request\n${request.message}`);
  }
  return parts.join("\n\n") || "(no message provided)";
}
