import fs from "node:fs";
import path from "node:path";
import type { ModelSummary } from "../aggregate";
import type { BenchmarkReport } from "./json-report";
import type { ProviderStatus } from "../types";

function pct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "n/a" : `${(value * 100).toFixed(digits)}%`;
}

function score(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(1);
}

function ms(value: number | undefined): string {
  return value === undefined ? "n/a" : `${Math.round(value)} ms`;
}

function usd(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : `$${value.toFixed(6)}`;
}

function label(summary: ModelSummary): string {
  const variant = summary.variant === "A" ? "" : ` var${summary.variant}`;
  return `[${summary.group}] ${summary.model}${variant}`;
}

function providerTable(statuses: ProviderStatus[]): string {
  const rows = statuses.map(
    (s) =>
      `| ${s.provider} | ${s.status} | ${s.credentialPresent ? "yes" : "no"} | ${s.sdkVersion} | ${s.apiMode} | ${
        s.discoveredModels ? `${s.discoveredModels.length} listed` : "not discoverable"
      } | ${s.reason} |`,
  );
  return [
    "| Provider | Status | Credential | SDK | API mode | Models | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

export function renderMarkdown(report: BenchmarkReport, summaries: ModelSummary[]): string {
  const lines: string[] = [];

  lines.push(
    report.mode === "dry" ? "# AI Benchmark — DRY RUN (MOCKED)" : "# AI Benchmark — latest run",
  );
  lines.push("");
  // Phase 21 §10: the first thing a reader sees has to be what the numbers
  // are, not what they say. A mocked table and a measured table are the same
  // table, and this document gets pasted into other documents.
  if (report.mode === "dry") {
    lines.push(
      "> **These numbers are MOCKED.** Every result came from the deterministic stub " +
        "provider; no provider was contacted and nothing here measures a model. This " +
        "artifact exists to prove the harness runs, and must never be quoted as a " +
        "benchmark result.",
    );
    lines.push("");
  }
  lines.push(`- **Mode:** ${report.mode === "dry" ? "DRY (mocked, 0 provider calls)" : "LIVE"}`);
  lines.push(`- **Status:** ${report.status}`);
  lines.push(`- **Run:** \`${report.run_id}\` (suite: ${report.suite}, benchmark v${report.benchmark_version})`);
  lines.push(`- **Commit:** ${report.commit ?? "unknown"}`);
  lines.push(`- **Timestamp:** ${report.timestamp}`);
  lines.push(
    report.completeness.status === "complete"
      ? `- **Completeness:** complete (${report.completeness.plannedCalls} planned calls, none skipped)`
      : `- **Completeness:** \`PARTIAL\` — ${report.completeness.skippedCalls} of ${report.completeness.plannedCalls} planned calls were skipped (${report.completeness.reason}). Scores below cover only what ran.`,
  );
  lines.push(
    `- **Execution modes:** ${Object.entries(report.execution_modes)
      .map(([mode, n]) => `${mode}=${n}`)
      .join(", ") || "none"}`,
  );
  lines.push("");

  if (report.caveats.length) {
    lines.push("> **Read this before quoting any number below.**");
    for (const caveat of report.caveats) lines.push(`> - ${caveat}`);
    lines.push("");
  }

  lines.push("## Provider status");
  lines.push("");
  lines.push(providerTable(Object.values(report.providers)));
  lines.push("");

  if (summaries.length === 0) {
    lines.push("## Results");
    lines.push("");
    lines.push("No executions were produced. Nothing about model quality can be concluded from this run.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("## Overall");
  lines.push("");
  lines.push("| Group | Provider | Model | Mode | Scenarios | Provider calls | Overall | Failure rate |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of summaries) {
    lines.push(
      `| ${s.group} | ${s.provider} | ${s.model} | ${s.mode} | ${s.scenarios} | ${s.providerCalls} | ${score(s.overall)} | ${pct(s.failureRate)} |`,
    );
  }
  lines.push("");

  lines.push("## Rubric dimensions (0-100)");
  lines.push("");
  const dimensionKeys = Object.keys(summaries[0].dimensions) as (keyof ModelSummary["dimensions"])[];
  lines.push(`| Dimension | ${summaries.map(label).join(" | ")} |`);
  lines.push(`| --- | ${summaries.map(() => "---").join(" | ")} |`);
  for (const key of dimensionKeys) {
    lines.push(`| ${key} | ${summaries.map((s) => score(s.dimensions[key])).join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Category scores (0-100)");
  lines.push("");
  const categories = [...new Set(summaries.flatMap((s) => Object.keys(s.categories)))].sort();
  lines.push(`| Category | ${summaries.map(label).join(" | ")} |`);
  lines.push(`| --- | ${summaries.map(() => "---").join(" | ")} |`);
  for (const cat of categories) {
    lines.push(
      `| ${cat} | ${summaries.map((s) => score(s.categories[cat as keyof typeof s.categories])).join(" | ")} |`,
    );
  }
  lines.push("");

  lines.push("## RAG, citation and hallucination");
  lines.push("");
  lines.push(`| Metric | ${summaries.map(label).join(" | ")} |`);
  lines.push(`| --- | ${summaries.map(() => "---").join(" | ")} |`);
  lines.push(`| Citation precision | ${summaries.map((s) => pct(s.citationPrecision)).join(" | ")} |`);
  lines.push(`| Citation recall | ${summaries.map((s) => pct(s.citationRecall)).join(" | ")} |`);
  lines.push(`| Fabricated citation rate | ${summaries.map((s) => pct(s.fabricatedCitationRate)).join(" | ")} |`);
  lines.push(`| Unsupported claim rate | ${summaries.map((s) => pct(s.unsupportedClaimRate)).join(" | ")} |`);
  lines.push(`| Hallucination rate | ${summaries.map((s) => pct(s.hallucinationRate)).join(" | ")} |`);
  lines.push(`| Abstention accuracy | ${summaries.map((s) => pct(s.abstentionAccuracy)).join(" | ")} |`);
  lines.push(`| Dataset-guard block rate | ${summaries.map((s) => pct(s.datasetGuardBlockRate)).join(" | ")} |`);
  lines.push("");

  const ragClasses = [...new Set(summaries.flatMap((s) => Object.keys(s.ragByClass)))].sort();
  if (ragClasses.length) {
    lines.push("### RAG by answerability class");
    lines.push("");
    lines.push(`| Class | Metric | ${summaries.map(label).join(" | ")} |`);
    lines.push(`| --- | --- | ${summaries.map(() => "---").join(" | ")} |`);
    for (const cls of ragClasses) {
      lines.push(`| ${cls} | n | ${summaries.map((s) => String(s.ragByClass[cls]?.n ?? 0)).join(" | ")} |`);
      lines.push(`| ${cls} | overall | ${summaries.map((s) => score(s.ragByClass[cls]?.overall)).join(" | ")} |`);
      lines.push(`| ${cls} | groundedness | ${summaries.map((s) => score(s.ragByClass[cls]?.groundedness)).join(" | ")} |`);
      lines.push(`| ${cls} | citation precision | ${summaries.map((s) => pct(s.ragByClass[cls]?.citationPrecision)).join(" | ")} |`);
      lines.push(`| ${cls} | citation recall | ${summaries.map((s) => pct(s.ragByClass[cls]?.citationRecall)).join(" | ")} |`);
      lines.push(`| ${cls} | abstention accuracy | ${summaries.map((s) => pct(s.ragByClass[cls]?.abstentionAccuracy)).join(" | ")} |`);
    }
    lines.push("");
  }

  lines.push("## Latency");
  lines.push("");
  lines.push(`| Metric | ${summaries.map(label).join(" | ")} |`);
  lines.push(`| --- | ${summaries.map(() => "---").join(" | ")} |`);
  lines.push(`| n | ${summaries.map((s) => String(s.latency.n)).join(" | ")} |`);
  lines.push(`| min | ${summaries.map((s) => ms(s.latency.min)).join(" | ")} |`);
  lines.push(`| median | ${summaries.map((s) => ms(s.latency.median)).join(" | ")} |`);
  lines.push(`| p95 | ${summaries.map((s) => ms(s.latency.p95)).join(" | ")} |`);
  lines.push(`| max | ${summaries.map((s) => ms(s.latency.max)).join(" | ")} |`);
  lines.push("");

  lines.push("## Tokens and cost");
  lines.push("");
  lines.push(`| Metric | ${summaries.map(label).join(" | ")} |`);
  lines.push(`| --- | ${summaries.map(() => "---").join(" | ")} |`);
  lines.push(`| Median input tokens | ${summaries.map((s) => score(s.tokens.medianInput)).join(" | ")} |`);
  lines.push(`| Median output tokens | ${summaries.map((s) => score(s.tokens.medianOutput)).join(" | ")} |`);
  lines.push(`| Median total tokens | ${summaries.map((s) => score(s.tokens.medianTotal)).join(" | ")} |`);
  lines.push(`| Median reasoning/thinking tokens | ${summaries.map((s) => score(s.tokens.medianReasoning)).join(" | ")} |`);
  lines.push(`| Median retrieved-context tokens | ${summaries.map((s) => score(s.tokens.medianRetrievedContext)).join(" | ")} |`);
  lines.push(`| Usage from provider / estimated | ${summaries.map((s) => `${s.tokens.providerReported} / ${s.tokens.estimated}`).join(" | ")} |`);
  lines.push(`| Cost per request | ${summaries.map((s) => usd(s.cost.perRequestUsd)).join(" | ")} |`);
  lines.push(`| Cost per successful answer | ${summaries.map((s) => usd(s.cost.perSuccessUsd)).join(" | ")} |`);
  lines.push(`| Rate source | ${summaries.map((s) => s.cost.rateSource).join(" | ")} |`);
  lines.push(`| Verified-cost share | ${summaries.map((s) => pct(s.verifiedCostRate)).join(" | ")} |`);
  lines.push(`| Quality per 1K tokens | ${summaries.map((s) => score(s.qualityPerKiloToken)).join(" | ")} |`);
  lines.push("");

  if (report.failures.length) {
    lines.push("## Failures");
    lines.push("");
    lines.push("| Scenario | Model | Type | Severity | Reproducible | Probable cause |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const f of report.failures.slice(0, 60)) {
      lines.push(
        `| ${f.scenarioId} | ${f.provider}/${f.model} | ${f.failureType} | ${f.severity} | ${
          f.reproducible ? "yes" : "not yet" } | ${f.probableCause.replace(/\|/g, "/").slice(0, 160)} |`,
      );
    }
    if (report.failures.length > 60) lines.push("");
    if (report.failures.length > 60) lines.push(`_${report.failures.length - 60} further failures in \`latest.json\`._`);
    lines.push("");
  }

  if (report.recommendations.length) {
    lines.push("## Recommendations");
    lines.push("");
    for (const rec of report.recommendations) lines.push(`- ${rec}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function writeMarkdown(outDir: string, markdown: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "latest.md"), `${markdown}\n`);
}
