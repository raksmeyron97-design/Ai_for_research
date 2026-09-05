import { describe, expect, it } from "vitest";
import { runAnalysisChecks } from "../analysis-traceability";
import type { ParsedDataset } from "../../data/parse-dataset";
import { EMPTY_MODEL, type MethodologyModel } from "../../methodology/model";
import {
  completeModel,
  hypothesis,
} from "../../methodology/__tests__/fixtures";
import type { ReviewFinding } from "../types";

function claim(over: Partial<Parameters<typeof runAnalysisChecks>[0]["claims"][number]> = {}) {
  return {
    id: "claim-a",
    claim_text: "The sample scored highly (M = 4.2).",
    section_type: "results" as const,
    claim_type: "factual" as const,
    ...over,
  };
}

function dataset(columns: Record<string, (string | number)[]>): ParsedDataset {
  const names = Object.keys(columns);
  const length = names.length > 0 ? columns[names[0]].length : 0;
  return {
    columns: names.map((name) => ({ name, type: "numeric" as const })),
    rows: Array.from({ length }, (_, i) => {
      const row: Record<string, string | number> = {};
      for (const name of names) row[name] = columns[name][i];
      return row;
    }),
  } as ParsedDataset;
}

function run(over: Partial<Parameters<typeof runAnalysisChecks>[0]> = {}) {
  return runAnalysisChecks({
    claims: [],
    methodologyLinks: [],
    methodology: EMPTY_MODEL,
    datasets: [],
    ...over,
  });
}

function rule(findings: ReviewFinding[], name: string): ReviewFinding | undefined {
  return findings.find((f) => f.id.startsWith(`analysis:${name}:`));
}

describe("result traceability is reported as absent, not faked (§24)", () => {
  it("always reports result traceability as not computable", () => {
    // Nothing stores the outcome of an analysis per hypothesis, so the
    // Hypothesis -> Analysis -> Result -> Claim chain has no Result to walk.
    const metric = run().metrics.find((m) => m.id === "result_traceability");
    expect(metric?.value).toBeNull();
    expect(metric?.status).toBe("not_computable");
  });

  it("says why, rather than showing an unexplained blank", () => {
    const metric = run().metrics.find((m) => m.id === "result_traceability");
    expect(metric?.reason).toMatch(/nothing records the outcome of an analysis per hypothesis/i);
  });

  it("stays not computable even with datasets and hypotheses present", () => {
    // A dataset is not a result. Computing descriptive statistics on demand
    // does not make "H1 was supported" a stored fact.
    const metric = run({
      methodology: completeModel(),
      datasets: [dataset({ score: [1, 2, 3, 4] })],
      claims: [claim()],
    }).metrics.find((m) => m.id === "result_traceability");
    expect(metric?.value).toBeNull();
  });

  it("invents no statistics anywhere in its output", () => {
    // §24's explicit prohibition: no p-values, effect sizes, sample sizes,
    // confidence intervals or significance verdicts conjured from nothing.
    const result = run({
      methodology: completeModel(),
      claims: [claim({ claim_text: "The effect was significant." })],
    });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/p\s*[=<]\s*0?\.\d/);
    expect(text).not.toMatch(/statistically significant/i);
    expect(text).not.toMatch(/95% (confidence|CI)/i);
  });
});

describe("numbers that name no column (§20)", () => {
  it("reports a number that cannot be matched to any dataset column", () => {
    // Phase 19 only reports a number that matched a column and disagreed
    // with it. This is the quieter case that produced nothing at all.
    const findings = run({
      claims: [claim({ claim_text: "Commute time was high (M = 4.2)." })],
      datasets: [dataset({ unrelated_column: [1, 2, 3] })],
    }).findings;
    const finding = rule(findings, "number-untraceable");
    expect(finding?.severity).toBe("info");
    expect(finding?.category).toBe("analysis");
  });

  it("says nothing when no dataset is linked at all", () => {
    // With no data, every mention is "not computable" rather than
    // untraceable — reporting it would fire on every number in a thesis
    // whose data has not been uploaded yet.
    const findings = run({
      claims: [claim({ claim_text: "The average was high (M = 4.2)." })],
      datasets: [],
    }).findings;
    expect(rule(findings, "number-untraceable")).toBeUndefined();
  });

  it("phrases it as the tool's failure to match, not as a defect in the thesis", () => {
    // The column match is a name heuristic. "Untraceable" means "not found",
    // and saying otherwise would put a heuristic's miss in front of a
    // researcher as if their number were wrong.
    const finding = rule(
      run({
        claims: [claim({ claim_text: "Commute time was high (M = 4.2)." })],
        datasets: [dataset({ unrelated_column: [1, 2, 3] })],
      }).findings,
      "number-untraceable",
    );
    expect(finding?.explanation).toMatch(/may simply mean the column is named differently/i);
  });
});

describe("a hypothesis nothing reports on (§16's reverse traversal)", () => {
  function withHypotheses(model: MethodologyModel) {
    return model;
  }

  it("reports a hypothesis with no linked claim in the results", () => {
    const findings = run({
      methodology: withHypotheses(completeModel()),
      claims: [claim()],
      methodologyLinks: [],
    }).findings;
    const finding = rule(findings, "hypothesis-not-reported");
    expect(finding?.severity).toBe("warning");
    expect(finding?.targetType).toBe("hypothesis");
  });

  it("stays quiet before the results chapter exists", () => {
    // Hypotheses written and results not yet drafted is order, not omission.
    const findings = run({
      methodology: withHypotheses(completeModel()),
      claims: [claim({ section_type: "literature_review" as never })],
    }).findings;
    expect(rule(findings, "hypothesis-not-reported")).toBeUndefined();
  });

  it("counts a hypothesis reported by a discussion claim as reported", () => {
    const model = completeModel();
    const findings = run({
      methodology: model,
      claims: [claim({ id: "claim-d", section_type: "discussion" as const })],
      methodologyLinks: [{ claim_id: "claim-d", hypothesis_id: model.hypotheses[0].id }],
    }).findings;
    expect(rule(findings, "hypothesis-not-reported")).toBeUndefined();
  });

  it("does not count a link from a literature-review claim", () => {
    // A hypothesis "reported on" in the literature review has not been
    // answered by this study.
    const model = completeModel();
    const findings = run({
      methodology: model,
      claims: [
        claim({ id: "claim-r", section_type: "results" as const }),
        claim({ id: "claim-l", section_type: "literature_review" as never }),
      ],
      methodologyLinks: [{ claim_id: "claim-l", hypothesis_id: model.hypotheses[0].id }],
    }).findings;
    expect(rule(findings, "hypothesis-not-reported")).toBeDefined();
  });
});

describe("hypothesis reporting coverage", () => {
  it("is not computable when the study has no hypotheses", () => {
    const metric = run({ claims: [claim()] }).metrics.find((m) => m.id === "hypothesis_reporting");
    expect(metric?.value).toBeNull();
    expect(metric?.reason).toMatch(/no hypotheses/i);
  });

  it("is not computable before any results claim exists", () => {
    const metric = run({ methodology: completeModel() }).metrics.find(
      (m) => m.id === "hypothesis_reporting",
    );
    expect(metric?.value).toBeNull();
    expect(metric?.reason).toMatch(/no claims have been extracted/i);
  });

  it("scores 1 when every hypothesis is reported on", () => {
    const model = completeModel();
    const metric = run({
      methodology: model,
      claims: [claim({ id: "claim-r" })],
      methodologyLinks: [{ claim_id: "claim-r", hypothesis_id: model.hypotheses[0].id }],
    }).metrics.find((m) => m.id === "hypothesis_reporting");
    expect(metric?.value).toBe(1);
    expect(metric?.status).toBe("ok");
  });

  it("reports the counts behind the ratio", () => {
    const model = completeModel();
    model.hypotheses.push(hypothesis({ id: "hyp-second", label: "H2" }));
    const metric = run({
      methodology: model,
      claims: [claim({ id: "claim-r" })],
      methodologyLinks: [{ claim_id: "claim-r", hypothesis_id: model.hypotheses[0].id }],
    }).metrics.find((m) => m.id === "hypothesis_reporting");
    expect(metric?.evidence).toEqual({ covered: 1, total: 2 });
  });
});

describe("provenance discipline (§23)", () => {
  it("emits only deterministic findings", () => {
    const result = run({
      methodology: completeModel(),
      claims: [claim({ claim_text: "Commute time was high (M = 4.2)." })],
      datasets: [dataset({ unrelated_column: [1, 2, 3] })],
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.provenance === "deterministic")).toBe(true);
  });

  it("never raises an analysis finding to error", () => {
    // Every check here rests on a name heuristic or on a link the researcher
    // may simply not have made yet. Neither is a structural failure.
    const result = run({
      methodology: completeModel(),
      claims: [claim({ claim_text: "Commute time was high (M = 4.2)." })],
      datasets: [dataset({ unrelated_column: [1, 2, 3] })],
    });
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});
