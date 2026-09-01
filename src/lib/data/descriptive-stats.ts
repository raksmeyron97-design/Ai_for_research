import type { ColumnSchema, ColumnType } from "../db/types";
import type { ParsedDataset } from "./parse-dataset";

export interface NumericSummary {
  type: "numeric";
  count: number;
  missing: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
}

export interface CategoricalSummary {
  type: "categorical";
  count: number;
  missing: number;
  frequencies: { value: string; count: number; percent: number }[];
}

export interface OtherSummary {
  type: "text" | "date";
  count: number;
  missing: number;
  uniqueCount: number;
}

export type ColumnSummary = NumericSummary | CategoricalSummary | OtherSummary;

/**
 * Real computation, not AI — every number here comes from the actual
 * uploaded data. This is what `results-generator.ts` hands to the model
 * as ground truth; the model is never the source of a statistic itself
 * (spec §27: "AI must never invent analysis output").
 */
export function summarizeDataset(dataset: ParsedDataset): Record<string, ColumnSummary> {
  const summary: Record<string, ColumnSummary> = {};
  for (const column of dataset.columns) {
    const values = dataset.rows.map((row) => row[column.name]);
    summary[column.name] = summarizeColumn(column, values);
  }
  return summary;
}

function summarizeColumn(column: ColumnSchema, values: (string | number | null)[]): ColumnSummary {
  const nonMissing = values.filter((v): v is string | number => v !== null);
  const missing = values.length - nonMissing.length;

  if (column.type === "numeric") {
    const numbers = nonMissing as number[];
    return {
      type: "numeric",
      count: numbers.length,
      missing,
      mean: mean(numbers),
      median: median(numbers),
      sd: sampleStandardDeviation(numbers),
      min: numbers.length ? Math.min(...numbers) : NaN,
      max: numbers.length ? Math.max(...numbers) : NaN,
    };
  }

  if (column.type === "categorical") {
    const strings = nonMissing as string[];
    const counts = new Map<string, number>();
    for (const v of strings) counts.set(v, (counts.get(v) ?? 0) + 1);
    const frequencies = [...counts.entries()]
      .map(([value, count]) => ({ value, count, percent: roundTo((count / strings.length) * 100, 1) }))
      .sort((a, b) => b.count - a.count);
    return { type: "categorical", count: strings.length, missing, frequencies };
  }

  return {
    type: column.type,
    count: nonMissing.length,
    missing,
    uniqueCount: new Set(nonMissing).size,
  };
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Sample standard deviation (n-1 denominator) — the standard convention for a sample drawn from a population, which survey/study data always is. */
export function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return values.length === 1 ? 0 : NaN;
  const m = mean(values);
  const sumSquaredDiffs = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
  return Math.sqrt(sumSquaredDiffs / (values.length - 1));
}

/** Pearson correlation coefficient between two equal-length numeric arrays, pairwise-excluding rows where either is missing. */
export function pearsonCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("pearsonCorrelation: arrays must be the same length");
  if (a.length < 2) return NaN;

  const meanA = mean(a);
  const meanB = mean(b);
  let numerator = 0;
  let sumSqA = 0;
  let sumSqB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    sumSqA += da * da;
    sumSqB += db * db;
  }
  const denominator = Math.sqrt(sumSqA * sumSqB);
  return denominator === 0 ? NaN : numerator / denominator;
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

// ---------------------------------------------------------------------
// Statistical Guard (spec §28) — recommends, never auto-runs
// ---------------------------------------------------------------------

export interface TestRecommendation {
  test: string;
  rationale: string;
  assumptionsToCheck: string[];
}

/**
 * Suggests which test *would* be appropriate for two variables, based on
 * their types (and, for two categorical variables, how many groups) —
 * it does not compute a p-value or run the test. Section 28 is explicit
 * that the final method depends on distribution/sample size/assumptions
 * this function has no way to check (e.g. normality), so every
 * recommendation comes with what still needs verifying before using it.
 */
export function recommendTest(
  typeA: ColumnType,
  typeB: ColumnType,
  groupCountA?: number,
  groupCountB?: number,
): TestRecommendation {
  if (typeA === "numeric" && typeB === "numeric") {
    return {
      test: "Pearson correlation (or Spearman if not linear/normal)",
      rationale: "Both variables are continuous/numeric.",
      assumptionsToCheck: [
        "Linearity between the two variables",
        "Roughly normal distribution of both variables (or use Spearman instead)",
        "No extreme outliers driving the relationship",
      ],
    };
  }

  const categoricalNumericPair =
    (typeA === "categorical" && typeB === "numeric") || (typeA === "numeric" && typeB === "categorical");
  if (categoricalNumericPair) {
    const groupCount = typeA === "categorical" ? groupCountA : groupCountB;
    if (groupCount === 2) {
      return {
        test: "Independent-samples t-test (or Mann-Whitney U if not normal)",
        rationale: "One numeric variable compared across exactly two groups.",
        assumptionsToCheck: [
          "Roughly normal distribution of the numeric variable within each group",
          "Similar variance between the two groups (or use Welch's t-test)",
          "Independent observations",
        ],
      };
    }
    if (groupCount && groupCount > 2) {
      return {
        test: "One-way ANOVA (or Kruskal-Wallis if not normal)",
        rationale: `One numeric variable compared across ${groupCount} groups.`,
        assumptionsToCheck: [
          "Roughly normal distribution within each group",
          "Similar variance across groups (Levene's test)",
          "Independent observations",
        ],
      };
    }
    return {
      test: "Independent-samples t-test or ANOVA, depending on group count",
      rationale: "One numeric and one categorical variable — the exact test depends on how many groups the categorical variable has.",
      assumptionsToCheck: ["Determine the number of groups first"],
    };
  }

  if (typeA === "categorical" && typeB === "categorical") {
    return {
      test: "Chi-square test of independence",
      rationale: "Both variables are categorical.",
      assumptionsToCheck: [
        "Expected cell counts of at least 5 in most cells (use Fisher's exact test if not)",
        "Independent observations",
      ],
    };
  }

  return {
    test: "No standard test recommended",
    rationale: `A ${typeA} and a ${typeB} variable don't have a standard paired statistical test — consider recoding one of them (e.g. bucket a date into categories) first.`,
    assumptionsToCheck: [],
  };
}
