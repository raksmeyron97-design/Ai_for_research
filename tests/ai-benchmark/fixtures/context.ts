import type { BenchmarkScenario, BenchmarkSource } from "../types";
import { getCorpus } from "./corpus";

/**
 * Two ways of handing retrieved evidence to the model.
 *
 * `keyed` is what `src/lib/ai/context-manager.ts` does now: each excerpt is
 * labelled with the citation key of its source, so a grounded answer can
 * emit a key that `integrity-guard.ts:verifyCitationKeys` resolves.
 *
 * `numbered` is what it did before the Phase 16 F2 fix — excerpts numbered
 * `[1]`, `[2]`, ... because `match_document_chunks` returned no citation
 * key, while every task prompt asked the model to cite `[citation_key]`.
 * It is kept, and not deleted with the bug, so the benchmark can quantify
 * what that fix actually bought once a live run is possible: run the same
 * scenarios under both and compare citation correctness. A regression that
 * silently reverted the join would show up as the two formats scoring the
 * same.
 */
export type ContextFormat = "keyed" | "numbered";

function renderExcerpt(source: BenchmarkSource, index: number, format: ContextFormat): string {
  const label = format === "numbered" ? `[${index + 1}]` : `[${source.citationKey}]`;
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
  format: ContextFormat = "keyed",
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
