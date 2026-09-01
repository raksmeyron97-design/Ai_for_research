import type { SupabaseClient } from "@supabase/supabase-js";
import { getCitationsByIds } from "../db/citations";
import { getRecentMessages } from "../db/messages";
import { getProject } from "../db/projects";
import { searchChunks } from "../db/chunks";
import { getSection } from "../db/sections";
import type { ChunkSearchResult, ResearchProjectRow, SectionType } from "../db/types";
import { embedQuery } from "./embeddings";
import { estimateTokens } from "./token-manager";
import { getMaxContextTokens } from "./model-config";

export interface ContextBuildParams {
  projectId: string;
  /** Layer 2 */
  sectionType?: SectionType;
  /** Drives Layer 3 retrieval — typically the user's message. No query, no document search. */
  query?: string;
  /** Post-filters Layer 3 results to these documents, if given. */
  documentIds?: string[];
  /** Layer 4 — specific citations to include verbatim, not a search. */
  sourceIds?: string[];
  /** Layer 5 — recent turns from this conversation, if any. */
  conversationId?: string;
  topK?: number;
}

/**
 * Assembles the layered context described in spec §10: minimal project
 * profile, current section, retrieved document excerpts, requested
 * sources, and recent conversation turns — as one string for
 * `AIRequest.context`. Independent layers fetch in parallel; retrieval
 * (embed the query, then search) is inherently sequential.
 *
 * This is a caller-side helper, not something AIOrchestrator calls
 * itself — the orchestrator has no DB client (Phase 1 scoping decision,
 * still true), so whatever calls AIOrchestrator.generate() builds context
 * first and passes the string in.
 */
export async function buildContext(
  supabase: SupabaseClient,
  params: ContextBuildParams,
): Promise<string> {
  const [project, section, citations, recentMessages] = await Promise.all([
    getProject(supabase, params.projectId),
    params.sectionType ? getSection(supabase, params.projectId, params.sectionType) : null,
    params.sourceIds?.length ? getCitationsByIds(supabase, params.sourceIds) : [],
    params.conversationId ? getRecentMessages(supabase, params.conversationId) : [],
  ]);

  let chunks: ChunkSearchResult[] = [];
  if (params.query?.trim()) {
    const queryEmbedding = await embedQuery(params.query);
    chunks = await searchChunks(supabase, params.projectId, queryEmbedding, params.topK ?? 8);
    if (params.documentIds?.length) {
      const allowed = new Set(params.documentIds);
      chunks = chunks.filter((c) => allowed.has(c.document_id));
    }
  }

  return assembleAndPrune({ project, section, chunks, citations, recentMessages }, getMaxContextTokens());
}

function formatProjectProfile(project: ResearchProjectRow): string {
  const lines = [
    `Title: ${project.title}`,
    `Language: ${project.language}`,
    project.discipline && `Discipline: ${project.discipline}`,
    project.study_design && `Study Design: ${project.study_design}`,
    project.target_population.length && `Population: ${project.target_population.join(", ")}`,
    project.location && `Location: ${project.location}`,
    project.sample_size && `Sample Size: ${project.sample_size}`,
    project.sampling_method && `Sampling Method: ${project.sampling_method}`,
    `Status: ${project.status}`,
  ].filter(Boolean);
  return `## Project Profile\n${lines.join("\n")}`;
}

function formatChunks(chunks: ChunkSearchResult[]): string {
  const entries = chunks.map((c, i) => {
    const loc = [c.page && `page ${c.page}`, c.section].filter(Boolean).join(", ");
    return `[${i + 1}]${loc ? ` (${loc})` : ""}: ${c.content}`;
  });
  return `## Relevant Document Excerpts\n${entries.join("\n\n")}`;
}

function formatCitations(citations: { citation_key: string; title: string | null; year: number | null; status: string }[]): string {
  const entries = citations.map(
    (c) => `[${c.citation_key}] ${c.title ?? "(untitled)"}${c.year ? ` (${c.year})` : ""} — status: ${c.status}`,
  );
  return `## Relevant Sources\n${entries.join("\n")}`;
}

function formatRecentMessages(messages: { role: string; content: string }[]): string {
  const entries = messages.map((m) => `${m.role}: ${m.content}`);
  return `## Recent Conversation\n${entries.join("\n")}`;
}

interface AssembleInput {
  project: ResearchProjectRow | null;
  section: { section_type: string; content: string } | null;
  chunks: ChunkSearchResult[];
  citations: { citation_key: string; title: string | null; year: number | null; status: string }[];
  recentMessages: { role: string; content: string }[];
}

/**
 * Pruning priority, cheapest-to-lose first: recent conversation, then
 * retrieved excerpts one at a time (already similarity-ordered, so this
 * drops the least-relevant chunk first rather than the whole layer at
 * once), then sources, then the current section. The project profile is
 * never dropped — Layer 1 is the one thing every task needs. This is a
 * real safeguard against an unbounded context, not a token-optimal
 * packer; see AI_RAG_ARCHITECTURE.md for what a finer-grained version
 * (e.g. per-chunk relevance-vs-cost scoring) would need.
 */
function assembleAndPrune(input: AssembleInput, maxTokens: number): string {
  const chunks = [...input.chunks];
  let recentMessages = input.recentMessages;
  let citations = input.citations;
  let includeSection = Boolean(input.section);

  const render = () =>
    [
      input.project ? formatProjectProfile(input.project) : null,
      includeSection && input.section
        ? `## Current Section: ${input.section.section_type}\n${input.section.content || "(empty)"}`
        : null,
      chunks.length ? formatChunks(chunks) : null,
      citations.length ? formatCitations(citations) : null,
      recentMessages.length ? formatRecentMessages(recentMessages) : null,
    ]
      .filter((p): p is string => Boolean(p))
      .join("\n\n");

  let result = render();
  while (estimateTokens(result) > maxTokens) {
    if (recentMessages.length > 0) recentMessages = [];
    else if (chunks.length > 0) chunks.pop();
    else if (citations.length > 0) citations = [];
    else if (includeSection) includeSection = false;
    else break; // only the (always-kept) project profile is left; stop rather than loop forever

    result = render();
  }

  return result;
}
