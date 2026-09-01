import type { ChunkSearchResult } from "../../db/types";
import type { RetrievalPort } from "../../evidence/evidence-search";
import type { MockBehavior } from "./mock-provider";

/**
 * Deterministic fixtures for the Phase 17B workflows (§32).
 *
 * These are not model output and are not meant to resemble it in quality.
 * They are exact payloads a test can script so the code *around* the model —
 * schema validation, the basis downgrade, ranking, the relation writes — is
 * what gets exercised. Every helper returns a `MockBehavior`, so they compose
 * with `createMockProvider({ script: [...] })` in call order.
 *
 * Nothing here contacts a provider, and nothing here is a research finding.
 */
export function claimExtractionFixture(
  claims: { text: string; type?: string; reason?: string; sourceSentence?: string }[],
): MockBehavior {
  return {
    kind: "valid",
    json: {
      claims: claims.map((c) => ({
        text: c.text,
        type: c.type ?? "factual",
        reason: c.reason ?? "",
        sourceSentence: c.sourceSentence ?? c.text,
      })),
    },
  };
}

export function sourceProfileFixture(
  fields: Partial<{
    population: string;
    study_design: string;
    sample: string;
    variables: string;
    main_finding: string;
    limitations: string;
    relevance: string;
  }>,
  statedFields: string[] = [],
): MockBehavior {
  return {
    kind: "valid",
    json: {
      population: fields.population ?? "",
      study_design: fields.study_design ?? "",
      sample: fields.sample ?? "",
      variables: fields.variables ?? "",
      main_finding: fields.main_finding ?? "",
      limitations: fields.limitations ?? "",
      relevance: fields.relevance ?? "",
      statedFields,
    },
  };
}

export function comparisonNotesFixture(
  agreements: { text: string; citationKeys: string[] }[],
  disagreements: { text: string; citationKeys: string[] }[] = [],
): MockBehavior {
  return { kind: "valid", json: { agreements, disagreements } };
}

export function themeSuggestionFixture(
  themes: { name: string; description?: string; citationKeys: string[] }[],
): MockBehavior {
  return {
    kind: "valid",
    json: {
      themes: themes.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        citationKeys: t.citationKeys,
      })),
    },
  };
}

export function gapSuggestionFixture(
  gaps: { text: string; citationKey?: string; basis?: string; supportingText?: string }[],
): MockBehavior {
  return {
    kind: "valid",
    json: {
      gaps: gaps.map((g) => ({
        text: g.text,
        citationKey: g.citationKey ?? "",
        basis: g.basis ?? "ai_inference",
        supportingText: g.supportingText ?? "",
      })),
    },
  };
}

/**
 * A retrieval port that runs no embedding call.
 *
 * `embedQuery` is a live provider request, so the real port cannot appear in a
 * test. Similarity is supplied per chunk by the test rather than computed:
 * inventing a similarity here would make the ranking assertions depend on a
 * fake scorer instead of on the ranking rules being tested.
 */
export function fixedRetrieval(chunks: ChunkSearchResult[]): RetrievalPort {
  return async ({ topK, documentIds }) => {
    const filtered = documentIds?.length
      ? chunks.filter((c) => documentIds.includes(c.document_id))
      : chunks;
    return filtered.slice(0, topK);
  };
}

/** A retrieval port that always fails, for the `retrieval_failed` path (§39). */
export function failingRetrieval(): RetrievalPort {
  return async () => {
    throw new Error("vector search unavailable");
  };
}

export function chunkFixture(over: Partial<ChunkSearchResult> & { id: string }): ChunkSearchResult {
  return {
    document_id: "00000000-0000-0000-0000-0000000000d1",
    chunk_index: 0,
    content: "",
    page: null,
    section: null,
    citation_key: null,
    similarity: 0.5,
    ...over,
  };
}
