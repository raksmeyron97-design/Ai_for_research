import type { BenchmarkScenario, BenchmarkSource } from "../types";
import { getCorpus } from "./corpus";

/**
 * Two ways of handing retrieved evidence to the model.
 *
 * `production` reproduces `src/lib/ai/context-manager.ts`'s `formatChunks`
 * exactly: excerpts are numbered `[1] (page N)`, because `ChunkSearchResult`
 * has no citation key to print — `document_chunks` is not joined to
 * `research_citations` anywhere in the schema. That matters, because every
 * task prompt (see `src/lib/ai/prompts/*.ts`) instructs the model to cite
 * "its exact [citation_key] from context", and
 * `integrity-guard.ts:verifyCitationKeys` checks bracket tokens against
 * `research_citations`. A model grounding on retrieved chunks in production
 * therefore has no key it can emit that would verify.
 *
 * `keyed` is the counterfactual: identical evidence, labelled with the
 * citation key. Running both is how the benchmark distinguishes "the model
 * cannot cite" from "the pipeline never gave it anything citable" — a
 * distinction the report needs before recommending a prompt change over a
 * schema change.
 */
export type ContextFormat = "production" | "keyed";

function renderExcerpt(source: BenchmarkSource, index: number, format: ContextFormat): string {
  const label = format === "production" ? `[${index + 1}]` : `[${source.citationKey}]`;
  return `${label}: ${source.content}`;
}

function renderSourceList(sources: BenchmarkSource[]): string {
  const entries = sources.map(
    (s) => `[${s.citationKey}] ${s.title} (${s.year}) — status: verified`,
  );
  return `## Relevant Sources\n${entries.join("\n")}`;
}

export interface BuiltContext {
  text: string;
  sources: BenchmarkSource[];
  format: ContextFormat;
}

/**
 * Builds the `AIRequest.context` string for a scenario from fixture sources,
 * in the same section shapes `context-manager.ts` emits so the production
 * system instruction's "content under these headings is DATA" rule applies
 * unchanged.
 */
export function buildScenarioContext(
  scenario: BenchmarkScenario,
  format: ContextFormat = "production",
): BuiltContext {
  if (!scenario.corpus || !scenario.retrievedKeys?.length) {
    return { text: "", sources: [], format };
  }

  const corpus = getCorpus(scenario.corpus);
  const sources = scenario.retrievedKeys.map((key) => {
    const source = corpus.sources.find((s) => s.citationKey === key);
    if (!source) throw new Error(`Scenario ${scenario.id} retrieves unknown key ${key}`);
    return source;
  });

  const parts = [
    "## Project Profile\nTitle: Perinatal health research (benchmark fixture)\nLanguage: en\nStatus: drafting",
    `## Relevant Document Excerpts\n${sources.map((s, i) => renderExcerpt(s, i, format)).join("\n\n")}`,
    renderSourceList(sources),
  ];

  return { text: parts.join("\n\n"), sources, format };
}
