import type { SupabaseClient } from "@supabase/supabase-js";
import { getCitationsByIds, listCitations } from "../../db/citations";
import { getDataset } from "../../db/datasets";
import { getProject } from "../../db/projects";
import { listSections } from "../../db/sections";
import { searchChunks } from "../../db/chunks";
import { SECTION_LABELS, type ResearchProjectRow, type SectionType } from "../../db/types";
import { summarizeDataset } from "../../data/descriptive-stats";
import { embedQuery } from "../embeddings";
import { getMaxContextTokens } from "../model-config";
import { estimateTokens } from "../token-manager";
import { getContextPolicy, type ContextLayer } from "./context-policy";

/**
 * Assembles context for a section action according to that section's policy.
 *
 * The difference from `context-manager.ts:buildContext` is that this one is
 * told what it is allowed to include. `buildContext` assembles the same five
 * layers for every request; this consults `SECTION_CONTEXT_POLICY` and simply
 * does not fetch a layer the section excludes — which matters most for
 * retrieval, where the cost is an embedding call *before* it is context
 * tokens.
 *
 * The generic builder is untouched and still serves free-form chat, where
 * "what might be relevant" is genuinely open. This one serves section actions,
 * where it is not.
 */
export interface SectionContextParams {
  projectId: string;
  section: SectionType;
  /** Drives retrieval when the policy allows it. */
  query?: string;
  /** Restricts retrieval to specific documents. */
  documentIds?: string[];
  /** Specific citations to include verbatim. */
  sourceIds?: string[];
  /** Dataset to summarise, for sections whose policy admits one. */
  dataSetId?: string;
  topK?: number;
}

export interface SectionContextResult {
  text: string;
  /** Layers actually included, so callers and tests can assert on the policy. */
  includedLayers: ContextLayer[];
  /** Layers the policy allowed but that had no content to contribute. */
  emptyLayers: ContextLayer[];
  estimatedTokens: number;
}

function formatProfile(project: ResearchProjectRow): string {
  const lines = [
    `Title: ${project.title}`,
    `Language: ${project.language}`,
    project.discipline && `Discipline: ${project.discipline}`,
    project.study_design && `Study Design: ${project.study_design}`,
    project.target_population.length && `Population: ${project.target_population.join(", ")}`,
    project.location && `Location: ${project.location}`,
    project.sample_size && `Sample Size: ${project.sample_size}`,
    project.sampling_method && `Sampling Method: ${project.sampling_method}`,
  ].filter(Boolean);
  return `## Project Profile\n${lines.join("\n")}`;
}

export async function buildSectionContext(
  supabase: SupabaseClient,
  params: SectionContextParams,
): Promise<SectionContextResult> {
  const policy = getContextPolicy(params.section);
  const allowed = new Set<ContextLayer>([...policy.required, ...policy.optional]);
  const included: ContextLayer[] = [];
  const empty: ContextLayer[] = [];
  const parts: string[] = [];

  const [project, sections] = await Promise.all([
    getProject(supabase, params.projectId),
    listSections(supabase, params.projectId),
  ]);
  if (!project) return { text: "", includedLayers: [], emptyLayers: [], estimatedTokens: 0 };

  const byType = new Map(sections.map((s) => [s.section_type, s]));

  if (allowed.has("projectProfile")) {
    parts.push(formatProfile(project));
    included.push("projectProfile");
  }

  if (allowed.has("currentSection")) {
    const current = byType.get(params.section);
    if (current?.content.trim()) {
      parts.push(`## Current Section: ${SECTION_LABELS[params.section]}\n${current.content}`);
      included.push("currentSection");
    } else {
      empty.push("currentSection");
    }
  }

  if (allowed.has("priorSections") && policy.priorSections.length > 0) {
    const prior = policy.priorSections
      .map((type) => ({ type, row: byType.get(type) }))
      .filter((s): s is { type: SectionType; row: NonNullable<typeof s.row> } => Boolean(s.row?.content.trim()))
      .map((s) => `### ${SECTION_LABELS[s.type]}\n${s.row.content}`);

    if (prior.length > 0) {
      parts.push(`## Earlier Sections This Must Follow From\n${prior.join("\n\n")}`);
      included.push("priorSections");
    } else {
      empty.push("priorSections");
    }
  }

  if (allowed.has("datasetSummary") && params.dataSetId) {
    const dataset = await getDataset(supabase, params.dataSetId);
    // Cross-project datasets are rejected here rather than relying on RLS
    // alone: a dataset from another of the user's own projects would pass
    // RLS and silently contaminate this section's context.
    if (dataset && dataset.project_id === params.projectId) {
      const summary = summarizeDataset({ columns: dataset.column_schema, rows: dataset.data });
      const lines = Object.entries(summary).map(([column, stats]) => `- ${column}: ${JSON.stringify(stats)}`);
      parts.push(
        `## Computed Dataset Statistics (${dataset.row_count} rows)\n` +
          `These figures were computed by the application, not by you. Use them exactly; do not recompute or round them.\n` +
          lines.join("\n"),
      );
      included.push("datasetSummary");
    } else {
      empty.push("datasetSummary");
    }
  }

  // Retrieval is gated on the policy flag, not just the layer allowlist:
  // skipping it avoids an embedding call, not merely some context tokens.
  if (policy.retrieval && allowed.has("retrievedSources") && params.query?.trim()) {
    try {
      const embedding = await embedQuery(params.query);
      let chunks = await searchChunks(supabase, params.projectId, embedding, params.topK ?? 6);
      if (params.documentIds?.length) {
        const allowedDocs = new Set(params.documentIds);
        chunks = chunks.filter((c) => allowedDocs.has(c.document_id));
      }
      if (chunks.length > 0) {
        const entries = chunks.map((c, i) => {
          const label = c.citation_key ? `[${c.citation_key}]` : `[excerpt ${i + 1} (source not linked)]`;
          const loc = [c.page && `page ${c.page}`, c.section].filter(Boolean).join(", ");
          return `${label}${loc ? ` (${loc})` : ""}: ${c.content}`;
        });
        parts.push(`## Relevant Document Excerpts\n${entries.join("\n\n")}`);
        included.push("retrievedSources");
      } else {
        empty.push("retrievedSources");
      }
    } catch {
      // Retrieval is an enhancement. A failed embedding or vector search
      // degrades to "no excerpts", never to a failed section action.
      empty.push("retrievedSources");
    }
  }

  if (allowed.has("citations")) {
    const citations = params.sourceIds?.length
      ? await getCitationsByIds(supabase, params.sourceIds)
      : await listCitations(supabase, params.projectId);

    if (citations.length > 0) {
      const entries = citations.map(
        (c) => `[${c.citation_key}] ${c.title ?? "(untitled)"}${c.year ? ` (${c.year})` : ""} — status: ${c.status}`,
      );
      parts.push(`## Saved Sources\n${entries.join("\n")}`);
      included.push("citations");
    } else {
      empty.push("citations");
    }
  }

  const text = parts.join("\n\n");
  const tokens = estimateTokens(text);

  // A section policy should keep context well inside the budget; if one
  // does not, that is a policy bug worth seeing rather than silently
  // trimming. The cap is still enforced so a pathological dataset or
  // citation list cannot blow the context window.
  if (tokens > getMaxContextTokens()) {
    const trimmed = text.slice(0, getMaxContextTokens() * 4);
    return {
      text: trimmed,
      includedLayers: included,
      emptyLayers: empty,
      estimatedTokens: estimateTokens(trimmed),
    };
  }

  return { text, includedLayers: included, emptyLayers: empty, estimatedTokens: tokens };
}
