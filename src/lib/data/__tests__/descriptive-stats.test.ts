import { describe, expect, it } from "vitest";
import {
  mean,
  median,
  pearsonCorrelation,
  recommendTest,
  sampleStandardDeviation,
  summarizeDataset,
} from "../descriptive-stats";
import type { ColumnSchema, DatasetRow } from "../../db/types";

describe("mean", () => {
  it("computes the arithmetic mean", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });
  it("is NaN for an empty array", () => {
    expect(mean([])).toBeNaN();
  });
  it("handles a single value", () => {
    expect(mean([7])).toBe(7);
  });
  it("handles negative numbers", () => {
    expect(mean([-2, 0, 2])).toBe(0);
  });
});

describe("median", () => {
  it("returns the middle value for an odd-length array", () => {
    expect(median([1, 3, 2])).toBe(2);
  });
  it("averages the two middle values for an even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
  it("is NaN for an empty array", () => {
    expect(median([])).toBeNaN();
  });
});

describe("sampleStandardDeviation", () => {
  it("matches a known textbook value (n-1 denominator)", () => {
    // classic example: {2,4,4,4,5,5,7,9}, mean=5, sample SD = 2.13809...
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(sampleStandardDeviation(values)).toBeCloseTo(2.13809, 4);
  });
  it("is 0 for a single value", () => {
    expect(sampleStandardDeviation([5])).toBe(0);
  });
  it("is NaN for an empty array", () => {
    expect(sampleStandardDeviation([])).toBeNaN();
  });
  it("is 0 when all values are identical", () => {
    expect(sampleStandardDeviation([3, 3, 3, 3])).toBe(0);
  });
});

describe("pearsonCorrelation", () => {
  it("is 1 for a perfect positive linear relationship", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });
  it("is -1 for a perfect negative linear relationship", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });
  it("is close to 0 for unrelated data", () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [3, 1, 4, 1, 5])).toBeGreaterThan(-0.6);
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [3, 1, 4, 1, 5])).toBeLessThan(0.6);
  });
  it("throws when arrays have different lengths", () => {
    expect(() => pearsonCorrelation([1, 2], [1, 2, 3])).toThrow();
  });
  it("is NaN when there's no variance in one variable", () => {
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBeNaN();
  });
});

describe("summarizeDataset", () => {
  const columns: ColumnSchema[] = [
    { name: "age", type: "numeric", missingCount: 1 },
    { name: "group", type: "categorical", missingCount: 0 },
  ];
  const rows: DatasetRow[] = [
    { age: 20, group: "A" },
    { age: 30, group: "B" },
    { age: 40, group: "A" },
    { age: null, group: "A" },
  ];

  it("computes real numeric statistics from actual row data, not placeholders", () => {
    const summary = summarizeDataset({ columns, rows });
    const age = summary.age;
    if (age.type !== "numeric") throw new Error("expected numeric");
    expect(age.count).toBe(3);
    expect(age.missing).toBe(1);
    expect(age.mean).toBe(30);
    expect(age.median).toBe(30);
    expect(age.min).toBe(20);
    expect(age.max).toBe(40);
  });

  it("computes real frequency counts and percentages for categorical columns", () => {
    const summary = summarizeDataset({ columns, rows });
    const group = summary.group;
    if (group.type !== "categorical") throw new Error("expected categorical");
    expect(group.count).toBe(4);
    const a = group.frequencies.find((f) => f.value === "A");
    const b = group.frequencies.find((f) => f.value === "B");
    expect(a).toEqual({ value: "A", count: 3, percent: 75 });
    expect(b).toEqual({ value: "B", count: 1, percent: 25 });
  });

  it("handles an all-missing numeric column without throwing", () => {
    const summary = summarizeDataset({
      columns: [{ name: "x", type: "numeric", missingCount: 2 }],
      rows: [{ x: null }, { x: null }],
    });
    const x = summary.x;
    if (x.type !== "numeric") throw new Error("expected numeric");
    expect(x.count).toBe(0);
    expect(x.missing).toBe(2);
    expect(x.mean).toBeNaN();
  });
});

describe("recommendTest (statistical guard — advisory only, never auto-runs)", () => {
  it("recommends correlation for two numeric variables", () => {
    const result = recommendTest("numeric", "numeric");
    expect(result.test).toMatch(/correlation/i);
  });

  it("recommends a t-test for numeric vs. a 2-group categorical variable", () => {
    const result = recommendTest("numeric", "categorical", undefined, 2);
    expect(result.test).toMatch(/t-test/i);
  });

  it("recommends ANOVA for numeric vs. a 3+-group categorical variable", () => {
    const result = recommendTest("categorical", "numeric", 4, undefined);
    expect(result.test).toMatch(/anova/i);
  });

  it("recommends chi-square for two categorical variables", () => {
    const result = recommendTest("categorical", "categorical");
    expect(result.test).toMatch(/chi-square/i);
  });

  it("recommends nothing standard for a text/date combination", () => {
    const result = recommendTest("text", "date");
    expect(result.test).toMatch(/no standard test/i);
  });

  it("always includes assumptions to check for a real recommended test", () => {
    const result = recommendTest("numeric", "numeric");
    expect(result.assumptionsToCheck.length).toBeGreaterThan(0);
  });

  it("never returns a p-value or computed statistic — it only recommends", () => {
    const result = recommendTest("numeric", "categorical", undefined, 2);
    expect(result).not.toHaveProperty("pValue");
    expect(result).not.toHaveProperty("statistic");
  });
});
