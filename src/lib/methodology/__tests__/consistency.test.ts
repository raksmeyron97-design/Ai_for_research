import { describe, expect, it } from "vitest";
import { runConsistencyChecks } from "../consistency";
import type { MethodologyFinding } from "../types";
import {
  completeModel,
  construct,
  hypothesis,
  hypothesisVariable,
  indicator,
  item,
  model,
  objective,
  researchQuestion,
  scale,
} from "./fixtures";

function rule(findings: MethodologyFinding[], name: string): MethodologyFinding | undefined {
  return findings.find((f) => f.id.startsWith(`${name}-`));
}

describe("a complete chain", () => {
  it("produces no errors", () => {
    const { findings } = runConsistencyChecks(completeModel());
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("scores every metric it can compute", () => {
    const { metrics } = runConsistencyChecks(completeModel());
    const coverage = metrics.find((m) => m.id === "measurement_coverage");
    expect(coverage?.value).toBe(1);
    expect(coverage?.evidence).toEqual({ covered: 2, total: 2 });
  });
});

describe("questions and objectives (§6)", () => {
  it("reports a question with no objective", () => {
    const q = researchQuestion({ id: "rq-a" });
    const { findings } = runConsistencyChecks(model({ questions: [q] }));
    expect(rule(findings, "question-no-objective")?.severity).toBe("warning");
  });

  it("reports an objective with no question", () => {
    const result = runConsistencyChecks(
      model({ questions: [researchQuestion({ id: "rq-a" })], objectives: [objective({ id: "obj-a" })] }),
    );
    expect(rule(result.findings, "objective-no-question")?.severity).toBe("warning");
  });

  // Ordinary work in progress, not a defect: with no questions in the project
  // there is nothing an objective could be linked to.
  it("softens the unlinked objective to info when no questions exist at all", () => {
    const { findings } = runConsistencyChecks(model({ objectives: [objective({ id: "obj-a" })] }));
    expect(rule(findings, "objective-no-question")?.severity).toBe("info");
  });

  // §6 forbids claiming a question is invalid.
  it("never says a research question is invalid", () => {
    const { findings } = runConsistencyChecks(model({ questions: [researchQuestion()] }));
    for (const f of findings) {
      expect(f.explanation).not.toMatch(/invalid|unscientific|wrong/i);
    }
  });

  it("does not ask a descriptive question for a hypothesis", () => {
    const q = researchQuestion({ id: "rq-a", question_kind: "descriptive" });
    const { findings } = runConsistencyChecks(
      model({ questions: [q], hypotheses: [hypothesis({ id: "hyp-a", objective_id: null })] }),
    );
    expect(rule(findings, "question-no-hypothesis")).toBeUndefined();
  });
});

describe("constructs and definitions (§7, §9)", () => {
  it("separates a missing operational definition from a missing conceptual one", () => {
    const { findings } = runConsistencyChecks(
      model({ constructs: [construct({ id: "con-a", operational_definition: null })] }),
    );
    const operational = rule(findings, "construct-no-operational");
    expect(operational?.severity).toBe("warning");
    expect(operational?.explanation).toMatch(/how it will be observed/i);
  });

  it("reports a construct nothing measures as an error", () => {
    const { findings } = runConsistencyChecks(model({ constructs: [construct({ id: "con-a" })] }));
    expect(rule(findings, "construct-unmeasured")?.severity).toBe("error");
  });

  it("flags two constructs whose names use the same words", () => {
    const { findings } = runConsistencyChecks(
      model({
        constructs: [
          construct({ id: "con-a", name: "Teacher motivation" }),
          construct({ id: "con-b", name: "Motivation of teachers" }),
        ],
      }),
    );
    expect(rule(findings, "construct-near-duplicate")).toBeDefined();
  });

  it("reports an indicator with no item", () => {
    const c = construct({ id: "con-a" });
    const { findings } = runConsistencyChecks(
      model({
        constructs: [c],
        indicators: [indicator({ id: "ind-a", construct_id: c.id, name: "Job satisfaction" })],
        items: [item({ id: "q-a", construct_id: c.id, indicator_id: null, scale_id: null, response_type: "open_text" })],
      }),
    );
    const uncovered = rule(findings, "indicator-uncovered");
    expect(uncovered?.severity).toBe("warning");
    expect(uncovered?.explanation).toMatch(/Job satisfaction/);
  });

  // Measuring a construct directly is workable; only saying so keeps the
  // finding from reading as a requirement to add indicators.
  it("softens 'no indicators' when items measure the construct directly", () => {
    const c = construct({ id: "con-a" });
    const { findings } = runConsistencyChecks(
      model({
        constructs: [c],
        items: [item({ id: "q-a", construct_id: c.id, indicator_id: null, scale_id: null, response_type: "open_text" })],
      }),
    );
    expect(rule(findings, "construct-no-indicator")?.severity).toBe("info");
  });
});

describe("hypotheses (§8)", () => {
  it("reports a hypothesis with no linked constructs", () => {
    const { findings } = runConsistencyChecks(
      model({ hypotheses: [hypothesis({ id: "hyp-a", objective_id: null })] }),
    );
    expect(rule(findings, "hypothesis-no-variables")?.severity).toBe("error");
  });

  it("reports a hypothesis with predictors but no outcome", () => {
    const c = construct({ id: "con-a" });
    const h = hypothesis({ id: "hyp-a", objective_id: null, question_id: null });
    const { findings } = runConsistencyChecks(
      model({
        constructs: [c],
        hypotheses: [h],
        hypothesisVariables: [hypothesisVariable({ hypothesis_id: h.id, construct_id: c.id, position: "predictor" })],
      }),
    );
    expect(rule(findings, "hypothesis-no-outcome")?.severity).toBe("error");
  });

  it("requires a mediation hypothesis to have a mediator", () => {
    const a = construct({ id: "con-a" });
    const b = construct({ id: "con-b", name: "Student performance" });
    const h = hypothesis({ id: "hyp-a", hypothesis_form: "mediation", objective_id: null });
    const { findings } = runConsistencyChecks(
      model({
        constructs: [a, b],
        hypotheses: [h],
        hypothesisVariables: [
          hypothesisVariable({ hypothesis_id: h.id, construct_id: a.id, position: "predictor" }),
          hypothesisVariable({ hypothesis_id: h.id, construct_id: b.id, position: "outcome" }),
        ],
      }),
    );
    expect(rule(findings, "hypothesis-mediation-no-mediator")?.severity).toBe("error");
  });

  it("reports a hypothesis using a construct nothing measures", () => {
    const base = completeModel();
    const { findings } = runConsistencyChecks({ ...base, items: [] });
    expect(rule(findings, "hypothesis-unmeasured-variable")?.severity).toBe("warning");
  });

  it("reports two hypotheses predicting opposite directions for the same pair", () => {
    const a = construct({ id: "con-a" });
    const b = construct({ id: "con-b", name: "Student performance" });
    const h1 = hypothesis({ id: "hyp-1", label: "H1", direction: "positive", objective_id: null, question_id: null });
    const h2 = hypothesis({ id: "hyp-2", label: "H2", direction: "negative", objective_id: null, question_id: null });
    const { findings } = runConsistencyChecks(
      model({
        constructs: [a, b],
        hypotheses: [h1, h2],
        hypothesisVariables: [
          hypothesisVariable({ hypothesis_id: h1.id, construct_id: a.id, position: "predictor" }),
          hypothesisVariable({ hypothesis_id: h1.id, construct_id: b.id, position: "outcome" }),
          hypothesisVariable({ hypothesis_id: h2.id, construct_id: a.id, position: "predictor" }),
          hypothesisVariable({ hypothesis_id: h2.id, construct_id: b.id, position: "outcome" }),
        ],
      }),
    );
    expect(rule(findings, "hypothesis-direction-conflict")).toBeDefined();
  });
});

describe("analysis plan (§33)", () => {
  it("notes a descriptive-only plan for a relational hypothesis, without declaring it wrong", () => {
    const base = completeModel();
    const withPlan = {
      ...base,
      hypotheses: [{ ...base.hypotheses[0], analysis_method: "Descriptive frequencies only" }],
    };
    const finding = rule(runConsistencyChecks(withPlan).findings, "hypothesis-analysis-mismatch");
    expect(finding?.severity).toBe("warning");
    expect(finding?.explanation).toMatch(/methodological judgement/i);
    expect(finding?.explanation).not.toMatch(/incorrect|invalid|wrong/i);
  });

  it("accepts an inferential method for a relational hypothesis", () => {
    expect(rule(runConsistencyChecks(completeModel()).findings, "hypothesis-analysis-mismatch")).toBeUndefined();
  });
});

describe("metrics (§14)", () => {
  it("returns null, not zero, when a dimension has nothing to measure", () => {
    const { metrics } = runConsistencyChecks(model());
    for (const metric of metrics) {
      expect(metric.value).toBeNull();
      expect(metric.status).toBe("not_computable");
    }
  });

  it("counts a partially covered model rather than rounding it to a verdict", () => {
    const c = construct({ id: "con-a" });
    const covered = indicator({ id: "ind-a", construct_id: c.id });
    const uncovered = indicator({ id: "ind-b", construct_id: c.id, name: "Effort" });
    const { metrics } = runConsistencyChecks(
      model({
        constructs: [c],
        indicators: [covered, uncovered],
        scales: [scale({ id: "sc-a" })],
        items: [item({ id: "q-a", construct_id: c.id, indicator_id: covered.id, scale_id: "sc-a" })],
      }),
    );
    const coverage = metrics.find((m) => m.id === "measurement_coverage");
    expect(coverage?.value).toBe(0.5);
    expect(coverage?.evidence).toEqual({ covered: 1, total: 2 });
  });

  it("orders findings with errors first", () => {
    const { findings } = runConsistencyChecks(completeModel());
    const severities = findings.map((f) => f.severity);
    const sorted = [...severities].sort(
      (a, b) => ({ error: 0, warning: 1, info: 2 })[a] - ({ error: 0, warning: 1, info: 2 })[b],
    );
    expect(severities).toEqual(sorted);
  });
});

describe("provenance (§1.3)", () => {
  it("marks every deterministic finding as deterministic", () => {
    const { findings } = runConsistencyChecks(completeModel());
    expect(findings.every((f) => f.provenance === "deterministic")).toBe(true);
  });

  it("reports an unconfirmed AI construct as a suggestion, not a fact", () => {
    const base = completeModel();
    const { findings } = runConsistencyChecks({
      ...base,
      constructs: [{ ...base.constructs[0], provenance: "ai_suggested", confirmed: false }, base.constructs[1]],
    });
    expect(rule(findings, "construct-unconfirmed")?.severity).toBe("info");
  });
});
