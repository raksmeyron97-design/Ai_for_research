import type { SupabaseClient } from "@supabase/supabase-js";
import { getDataset } from "../db/datasets";
import { getProject } from "../db/projects";
import { getSection } from "../db/sections";
import type { ColumnSummary } from "../data/descriptive-stats";
import { summarizeDataset } from "../data/descriptive-stats";
import { AIOrchestrator } from "./orchestrator";

export class ResultsGenerationError extends Error {}

export interface ResultsAnalysis {
  datasetId: string;
  rowCount: number;
  summary: Record<string, ColumnSummary>;
  /** AI-authored narrative interpreting the summary above — the model never sees or produces the numbers themselves, only writes about the ones computed here. */
  interpretation: string;
}

/**
 * Runs descriptive analysis on a dataset (real computation, spec §27/§29)
 * and asks the model to write an interpretive paragraph *about* those
 * numbers — deliberately never asking the model to restate, recompute,
 * or reformat the numbers itself. Even a model given correct numbers as
 * context can subtly alter one when asked to reproduce it in a table;
 * having the app render `summary` directly (not through the model) means
 * every figure the researcher sees traces to `summarizeDataset()`, not to
 * anything the model wrote.
 */
export async function generateResultsAnalysis(
  supabase: SupabaseClient,
  projectId: string,
  datasetId: string,
  options: { userId?: string } = {},
): Promise<ResultsAnalysis> {
  const [project, dataset] = await Promise.all([getProject(supabase, projectId), getDataset(supabase, datasetId)]);

  if (!project) throw new ResultsGenerationError(`Project ${projectId} not found`);
  if (!dataset || dataset.project_id !== projectId) {
    throw new ResultsGenerationError(`Dataset ${datasetId} not found for this project`);
  }

  const summary = summarizeDataset({ columns: dataset.column_schema, rows: dataset.data });
  const objectives = await getSection(supabase, projectId, "objectives");

  const context = buildAnalysisContext(project.title, objectives?.content ?? null, summary);

  const orchestrator = new AIOrchestrator({ userId: options.userId, supabase });
  const response = await orchestrator.generate({
    projectId,
    taskType: "results_generation",
    dataSetId: datasetId,
    message:
      "Write an academic Results-section interpretation of the statistics below. Use ONLY the numbers given — do not compute, restate with different precision, or introduce any statistic not listed. If a number would be useful but isn't provided, say it would need to be computed rather than estimating it.",
    context,
  });

  return {
    datasetId,
    rowCount: dataset.row_count,
    summary,
    interpretation: response.content,
  };
}

function buildAnalysisContext(
  projectTitle: string,
  objectives: string | null,
  summary: Record<string, ColumnSummary>,
): string {
  const parts = [
    `## Project\n${projectTitle}`,
    objectives && `## Objectives\n${objectives}`,
    `## Computed Statistics (the only numbers you may reference)\n${formatSummary(summary)}`,
  ];
  return parts.filter((p): p is string => Boolean(p)).join("\n\n");
}

function formatSummary(summary: Record<string, ColumnSummary>): string {
  return Object.entries(summary)
    .map(([column, stat]) => {
      if (stat.type === "numeric") {
        return `- ${column} (numeric, n=${stat.count}, missing=${stat.missing}): mean=${round(stat.mean)}, median=${round(stat.median)}, SD=${round(stat.sd)}, min=${stat.min}, max=${stat.max}`;
      }
      if (stat.type === "categorical") {
        const top = stat.frequencies.map((f) => `${f.value}=${f.count} (${f.percent}%)`).join(", ");
        return `- ${column} (categorical, n=${stat.count}, missing=${stat.missing}): ${top}`;
      }
      return `- ${column} (${stat.type}, n=${stat.count}, missing=${stat.missing}, unique=${stat.uniqueCount})`;
    })
    .join("\n");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
