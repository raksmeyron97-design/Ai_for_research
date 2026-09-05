import { summarizeDataset } from "../data/descriptive-stats";
import type { ParsedDataset } from "../data/parse-dataset";
import type { ResearchClaimRow } from "../db/types";

/**
 * Numerical claims get their own state vocabulary rather than reusing
 * `CitationVerificationState` — "is this number traceable to computed data"
 * is a different question from "is this claim's citation resolved", and a
 * claim can be perfectly cited while still stating a number nothing in the
 * project's datasets backs up.
 */
export type NumericTraceState = "traceable" | "untraceable" | "inconsistent" | "not_computable";

export interface NumericMention {
  raw: string;
  statistic: "mean" | "sd" | "percentage" | "n" | "correlation" | "p_value";
  value: number;
}

export interface NumericClaimTrace {
  claimId: string;
  mention: NumericMention;
  state: NumericTraceState;
  /** The dataset column this mention was checked against, when one was found in the claim's own text. */
  matchedColumn: string | null;
  explanation: string;
}

const TOLERANCE_ABS = 0.05;
const TOLERANCE_REL = 0.02;

function withinTolerance(claimed: number, computed: number): boolean {
  const tolerance = Math.max(TOLERANCE_ABS, Math.abs(computed) * TOLERANCE_REL);
  return Math.abs(claimed - computed) <= tolerance;
}

/**
 * Numeric statements a claim makes, by the shape a researcher would actually
 * write them. Deliberately narrow patterns (`M=`, `SD=`, `n=`, `r=`, a bare
 * `%`) rather than "any number in the sentence" — a section number, a year,
 * or a Likert-scale point is a number too, and treating every digit as a
 * traceability target would flood the review with noise about numbers that
 * were never meant to be a statistic.
 */
export function extractNumericMentions(text: string): NumericMention[] {
  const mentions: NumericMention[] = [];
  const patterns: { statistic: NumericMention["statistic"]; re: RegExp }[] = [
    { statistic: "mean", re: /\bM\s*=\s*(-?\d+(?:\.\d+)?)/gi },
    { statistic: "sd", re: /\bSD\s*=\s*(-?\d+(?:\.\d+)?)/gi },
    { statistic: "n", re: /\bn\s*=\s*(\d+)/gi },
    { statistic: "correlation", re: /\br\s*=\s*(-?0?\.\d+)/gi },
    { statistic: "p_value", re: /\bp\s*[<>=]\s*\.?\d+(?:\.\d+)?/gi },
    { statistic: "percentage", re: /(-?\d+(?:\.\d+)?)\s*%/g },
  ];

  for (const { statistic, re } of patterns) {
    for (const match of text.matchAll(re)) {
      const value = Number(match[1] ?? match[0].replace(/[^0-9.-]/g, ""));
      if (!Number.isNaN(value)) mentions.push({ raw: match[0], statistic, value });
    }
  }
  return mentions;
}

/**
 * A dataset column name mentioned in the claim's own text, case-insensitively
 * and on a word boundary — a plain substring check would let a column named
 * "age" match inside "averaged" or "package".
 */
function findCandidateColumn(text: string, dataset: ParsedDataset): string | null {
  return (
    dataset.columns.find((col) => {
      const escaped = col.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(text);
    })?.name ?? null
  );
}

/**
 * Traces every numeric mention in one claim against the project's datasets.
 * No dataset at all -> every mention is `not_computable`, never a guess.
 * `p_value` mentions are always `not_computable`: nothing in the schema
 * stores a computed inferential result to check against (no `result` or
 * `p_value` column exists anywhere in the methodology model), so claiming
 * otherwise would be exactly the kind of fabricated correction this module
 * must not produce.
 */
export function traceClaimNumbers(
  claim: Pick<ResearchClaimRow, "id" | "claim_text">,
  datasets: ParsedDataset[],
): NumericClaimTrace[] {
  const mentions = extractNumericMentions(claim.claim_text);
  if (mentions.length === 0) return [];

  return mentions.map((mention) => {
    if (mention.statistic === "p_value") {
      return {
        claimId: claim.id,
        mention,
        state: "not_computable",
        matchedColumn: null,
        explanation: "A p-value cannot currently be verified from stored analysis results.",
      };
    }

    if (datasets.length === 0) {
      return {
        claimId: claim.id,
        mention,
        state: "not_computable",
        matchedColumn: null,
        explanation: "No dataset is linked to this project, so this number cannot currently be verified.",
      };
    }

    for (const dataset of datasets) {
      const column = findCandidateColumn(claim.claim_text, dataset);
      if (!column) continue;

      const summary = summarizeDataset(dataset)[column];
      const computed = readStatistic(summary, mention.statistic);
      if (computed === null) continue;

      if (withinTolerance(mention.value, computed)) {
        return {
          claimId: claim.id,
          mention,
          state: "traceable",
          matchedColumn: column,
          explanation: `Matches the computed ${mention.statistic} (${computed}) for column "${column}".`,
        };
      }
      return {
        claimId: claim.id,
        mention,
        state: "inconsistent",
        matchedColumn: column,
        explanation: `Claims ${mention.statistic}=${mention.value}, but the computed value for column "${column}" is ${computed}.`,
      };
    }

    return {
      claimId: claim.id,
      mention,
      state: "untraceable",
      matchedColumn: null,
      explanation: "This number does not name a column that matches any linked dataset, so it cannot be matched to a computed value.",
    };
  });
}

function readStatistic(
  summary: ReturnType<typeof summarizeDataset>[string] | undefined,
  statistic: NumericMention["statistic"],
): number | null {
  if (!summary) return null;

  if (summary.type === "numeric") {
    if (statistic === "mean") return roundTo2(summary.mean);
    if (statistic === "sd") return roundTo2(summary.sd);
    if (statistic === "n") return summary.count;
  }

  if (summary.type === "categorical" && statistic === "percentage") {
    // Ambiguous which category a bare "%" refers to without a category name
    // in the claim text — this module only checks a total count/percentage
    // is plausible for the column, not which category it names.
    return null;
  }

  if (statistic === "n" && (summary.type === "categorical" || summary.type === "text" || summary.type === "date")) {
    return summary.count;
  }

  return null;
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}
