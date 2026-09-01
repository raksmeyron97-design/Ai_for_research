import type { SupabaseClient } from "@supabase/supabase-js";
import { searchChunks } from "../db/chunks";
import { listCitations } from "../db/citations";
import { embedQuery } from "../ai/embeddings";
import { extractCitationKeys } from "../ai/integrity-guard";
import { detectPromptInjection } from "../ai/prompt-injection-guard";
import type { ChunkSearchResult, ResearchCitationRow, SectionType } from "../db/types";
import { rankAll, type RankedEvidence } from "./ranking";

/**
 * Claim → focused retrieval → ranking → evidence candidates (§13).
 *
 * There is one vector index and this uses it. `searchChunks` and the
 * `match_document_chunks` RPC are Phase 3's; nothing here embeds documents,
 * stores vectors, or keeps a parallel copy of anything.
 *
 * Retrieval is reached through a port rather than called directly, for one
 * concrete reason: `embedQuery` is a live provider call, so a test that
 * exercised this function against the real default would spend credit. The
 * default *is* the real path — the port exists so an offline test can supply a
 * deterministic retriever, not so a second retrieval implementation can grow.
 */
export interface RetrievalRequest {
  projectId: string;
  query: string;
  topK: number;
  documentIds?: string[];
}

export type RetrievalPort = (request: RetrievalRequest) => Promise<ChunkSearchResult[]>;

export function createRetrievalPort(supabase: SupabaseClient): RetrievalPort {
  return async ({ projectId, query, topK, documentIds }) => {
    const embedding = await embedQuery(query);
    const chunks = await searchChunks(supabase, projectId, embedding, topK);
    if (!documentIds?.length) return chunks;
    const allowed = new Set(documentIds);
    return chunks.filter((c) => allowed.has(c.document_id));
  };
}

/** Why a search returned nothing, so the UI can say something useful (§39). */
export type EvidenceSearchOutcome = "ok" | "no_evidence_found" | "retrieval_failed";

export interface EvidenceCandidate extends RankedEvidence {
  /** True when this excerpt is already saved as a `research_evidence` row. */
  alreadySaved: boolean;
  /** Untrusted-content warning, when the excerpt contains instruction-like text (§35). */
  injectionWarning: string | null;
}

export interface EvidenceSearchResult {
  outcome: EvidenceSearchOutcome;
  candidates: EvidenceCandidate[];
  /** Exactly what was sent to retrieval, so token use is inspectable (§36). */
  query: string;
}

export interface EvidenceSearchParams {
  projectId: string;
  section: SectionType;
  claimText: string;
  /**
   * A short window of text around the claim. Trimmed hard: §36's rule is the
   * smallest useful context, and a whole section pulls the retrieval toward
   * the section's general topic and away from this specific assertion.
   */
  nearbyContext?: string;
  /** Section text, used only to see which sources are already cited here. */
  sectionContent?: string;
  documentIds?: string[];
  topK?: number;
}

/** Hard cap on the context window appended to the claim, in characters. */
const MAX_NEARBY_CONTEXT = 400;

export function buildRetrievalQuery(claimText: string, nearbyContext?: string): string {
  const claim = claimText.trim();
  const near = (nearbyContext ?? "").trim();
  if (!near) return claim;
  // The claim leads. Context is a hint, not half the query.
  return `${claim}\n\n${near.slice(0, MAX_NEARBY_CONTEXT)}`;
}

export async function searchEvidenceForClaim(
  supabase: SupabaseClient,
  params: EvidenceSearchParams,
  deps: { retrieve?: RetrievalPort } = {},
): Promise<EvidenceSearchResult> {
  const retrieve = deps.retrieve ?? createRetrievalPort(supabase);
  const query = buildRetrievalQuery(params.claimText, params.nearbyContext);

  let chunks: ChunkSearchResult[];
  try {
    chunks = await retrieve({
      projectId: params.projectId,
      query,
      topK: params.topK ?? 8,
      documentIds: params.documentIds,
    });
  } catch {
    // Distinguished from "found nothing": one means add sources, the other
    // means try again (§39).
    return { outcome: "retrieval_failed", candidates: [], query };
  }

  if (chunks.length === 0) return { outcome: "no_evidence_found", candidates: [], query };

  // Only the sources these chunks point at, and only the evidence rows that
  // already exist for those sources — not the library, not the project's
  // evidence (§38).
  const citationKeys = new Set(chunks.map((c) => c.citation_key).filter(Boolean) as string[]);
  const citations = await listCitations(supabase, params.projectId);
  const byKey = new Map<string, ResearchCitationRow>(
    citations.filter((c) => citationKeys.has(c.citation_key)).map((c) => [c.citation_key, c]),
  );

  const chunkIds = chunks.map((c) => c.id);
  const { data: existing } = await supabase
    .from("research_evidence")
    .select("chunk_id")
    .eq("project_id", params.projectId)
    .in("chunk_id", chunkIds);
  const savedChunkIds = new Set(((existing ?? []) as { chunk_id: string | null }[]).map((e) => e.chunk_id));

  const keysAlreadyInSection = params.sectionContent ? extractCitationKeys(params.sectionContent) : [];

  const ranked = rankAll(
    chunks.map((chunk) => ({
      claimText: params.claimText,
      section: params.section,
      chunk,
      citation: chunk.citation_key ? byKey.get(chunk.citation_key) : undefined,
      keysAlreadyInSection,
    })),
  );

  return {
    outcome: "ok",
    query,
    candidates: ranked.map((r) => ({
      ...r,
      alreadySaved: savedChunkIds.has(r.chunk.id),
      // The excerpt is document text and stays data (§35). Surfacing the
      // warning is all this does — it never filters the candidate out, because
      // a paper *about* prompt injection is a legitimate source.
      injectionWarning: detectPromptInjection(r.chunk.content)?.message ?? null,
    })),
  };
}
