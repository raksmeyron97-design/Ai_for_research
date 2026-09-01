import type { SupabaseClient } from "@supabase/supabase-js";
import { SECTION_CHAIN } from "../db/projects";
import type { SectionType } from "../db/types";
import { buildContext } from "./context-manager";
import type { ValidatedAIRequest } from "./request-schema";
import type { AIRequest } from "./types";

function asSectionType(value: string | undefined): SectionType | undefined {
  return value && (SECTION_CHAIN as readonly string[]).includes(value) ? (value as SectionType) : undefined;
}

/**
 * If the caller already assembled `context` themselves, use it as-is —
 * that's still a valid way to call the orchestrator. Otherwise, build it
 * from the request's projectId/sectionId/message/documentIds/sourceIds/
 * conversationId via ContextManager (Phase 3), so a UI caller only needs
 * to say *what* it wants, not assemble the context string by hand.
 */
export async function resolveRequestContext(
  supabase: SupabaseClient,
  request: ValidatedAIRequest,
): Promise<AIRequest> {
  if (request.context) return request;

  const context = await buildContext(supabase, {
    projectId: request.projectId,
    sectionType: asSectionType(request.sectionId),
    query: request.message,
    documentIds: request.documentIds,
    sourceIds: request.sourceIds,
    conversationId: request.conversationId,
  });

  return { ...request, context: context || undefined };
}
