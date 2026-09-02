import { describe, expect, it } from "vitest";
import { extractNumericMentions, traceClaimNumbers } from "../numerical-traceability";
import type { ParsedDataset } from "../../data/parse-dataset";

const AGE_DATASET: ParsedDataset = {
  columns: [{ name: "age", type: "numeric", missingCount: 0 }],
  rows: [{ age: 20 }, { age: 22 }, { age: 24 }, { age: 26 }, { age: 28 }],
};

describe("extractNumericMentions", () => {
  it("extracts M=, SD=, n=, r=, p, and % mentions", () => {
    const text = "Participants (n=120) had M=24.0, SD=3.2, r=.45, p<.05, and 60% were female.";
    const mentions = extractNumericMentions(text);
    const statistics = mentions.map((m) => m.statistic).sort();
    expect(statistics).toEqual(["mean", "n", "p_value", "percentage", "sd", "correlation"].sort());
  });

  it("returns nothing for prose with no statistic-shaped numbers", () => {
    expect(extractNumericMentions("Chapter 3 discusses the sample.")).toEqual([]);
  });
});

describe("traceClaimNumbers", () => {
  it("returns not_computable for every mention when no dataset is linked", () => {
    const claim = { id: "c1", claim_text: "The mean age was M=24.0." };
    const traces = traceClaimNumbers(claim, []);
    expect(traces).toHaveLength(1);
    expect(traces[0].state).toBe("not_computable");
  });

  it("returns not_computable for a p-value even when a dataset is linked", () => {
    const claim = { id: "c1", claim_text: "The result was significant, p<.05." };
    const traces = traceClaimNumbers(claim, [AGE_DATASET]);
    expect(traces[0].state).toBe("not_computable");
  });

  it("returns traceable when the claimed mean matches the computed column mean within tolerance", () => {
    const claim = { id: "c1", claim_text: "The mean age was M=24.0." };
    const traces = traceClaimNumbers(claim, [AGE_DATASET]);
    expect(traces[0].state).toBe("traceable");
    expect(traces[0].matchedColumn).toBe("age");
  });

  it("returns inconsistent when the claimed mean does not match the computed value", () => {
    const claim = { id: "c1", claim_text: "The mean age was M=40.0." };
    const traces = traceClaimNumbers(claim, [AGE_DATASET]);
    expect(traces[0].state).toBe("inconsistent");
  });

  it("returns untraceable when the claim names no column that matches any dataset", () => {
    const claim = { id: "c1", claim_text: "Satisfaction scores averaged M=4.2." };
    const traces = traceClaimNumbers(claim, [AGE_DATASET]);
    expect(traces[0].state).toBe("untraceable");
  });

  it("returns an empty array for a claim with no numeric mentions at all", () => {
    expect(traceClaimNumbers({ id: "c1", claim_text: "No numbers here." }, [AGE_DATASET])).toEqual([]);
  });
});
