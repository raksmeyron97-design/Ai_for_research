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
  return `${summary.provider} / ${summary.model} (variant ${summary.variant})`;
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

  lines.push("# AI Benchmark — latest run");
  lines.push("");
  lines.push(`- **Status:** ${report.status}`);
  lines.push(`- **Run:** \`${report.run_id}\` (suite: ${report.suite}, benchmark v${report.benchmark_version})`);
  lines.push(`- **Commit:** ${report.commit ?? "unknown"}`);
  lines.push(`- **Timestamp:** ${report.timestamp}`);
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
  lines.push("| Model | Mode | Scenarios | Overall | Failure rate | Retry rate |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const s of summaries) {
    lines.push(
      `| ${label(s)} | ${s.mode} | ${s.scenarios} | ${score(s.overall)} | ${pct(s.failureRate)} | ${pct(s.retryRate)} |`,
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
