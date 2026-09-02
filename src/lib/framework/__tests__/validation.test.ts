import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "../../review/types";
import { resolveNodes } from "../model";
import { runFrameworkChecks } from "../validation";
import {
  alignedFramework,
  construct,
  frameworkModel,
  frameworkNode,
  frameworkRelationship,
  hypothesis,
  hypothesisVariable,
  indicator,
  item,
} from "./fixtures";

function rule(findings: ReviewFinding[], name: string): ReviewFinding | undefined {
  return findings.find((f) => f.id.startsWith(`framework:${name}:`));
}

describe("a framework that agrees with its methodology", () => {
  it("reports nothing", () => {
    const { findings } = runFrameworkChecks(alignedFramework());
    expect(findings).toEqual([]);
  });

  it("scores full coverage on both metrics", () => {
    const { metrics } = runFrameworkChecks(alignedFramework());
    expect(metrics.find((m) => m.id === "framework_coverage")?.value).toBe(1);
    expect(metrics.find((m) => m.id === "framework_node_binding")?.value).toBe(1);
  });
});

describe("node binding (§6, §40)", () => {
  it("reports a node that names no construct", () => {
    const model = frameworkModel({
      nodes: [frameworkNode({ id: "fn-a", construct_id: null, label: "Motivation" })],
    });
    const finding = rule(runFrameworkChecks(model).findings, "node-unmapped");
    expect(finding?.severity).toBe("warning");
    expect(finding?.explanation).toContain("Motivation");
  });

  it("does not guess a mapping from a label that matches a construct name", () => {
    // §40: a free-text label identical to a construct's name is still
    // unmapped. Matching them by string is exactly the invented mapping the
    // phase brief forbids.
    const c = construct({ id: "con-a", name: "Teacher motivation" });
    const model = frameworkModel({
      nodes: [frameworkNode({ id: "fn-a", construct_id: null, label: "Teacher motivation" })],
      methodology: { ...frameworkModel().methodology, constructs: [c] },
    });
    const { findings } = runFrameworkChecks(model);
    expect(rule(findings, "node-unmapped")).toBeDefined();
    expect(rule(findings, "construct-not-in-framework")).toBeDefined();
  });

  it("prefers the construct's name over a stale label once mapped", () => {
    const c = construct({ id: "con-a", name: "Teacher motivation" });
    const resolved = resolveNodes(
      frameworkModel({
        nodes: [frameworkNode({ construct_id: "con-a", label: "old wording" })],
        methodology: { ...frameworkModel().methodology, constructs: [c] },
      }),
    );
    expect(resolved[0].displayName).toBe("Teacher motivation");
    expect(resolved[0].unmapped).toBe(false);
  });

  it("treats a construct deleted out from under a node as unmapped", () => {
    // The FK is `on delete set null`, so this is the state that actually
    // reaches the engine after a construct is deleted.
    const model = frameworkModel({
      nodes: [frameworkNode({ id: "fn-a", construct_id: null, label: "Was a construct" })],
    });
    expect(resolveNodes(model)[0].unmapped).toBe(true);
  });
});

describe("methodology synchronisation (§8)", () => {
  it("reports a construct with a role that the framework does not show", () => {
    const model = frameworkModel({
      methodology: {
        ...frameworkModel().methodology,
        constructs: [construct({ id: "con-a", name: "Teacher motivation", role: "independent" })],
      },
    });
    const finding = rule(runFrameworkChecks(model).findings, "construct-not-in-framework");
    expect(finding?.severity).toBe("warning");
    expect(finding?.targetId).toBe("con-a");
  });

  it("does not ask the framework to show a construct with no role yet", () => {
    // 'latent' is Phase 18's "not yet placed in the design". Reporting it
    // would turn work in progress into a finding.
    const model = frameworkModel({
      methodology: {
        ...frameworkModel().methodology,
        constructs: [construct({ id: "con-a", role: "latent" })],
      },
    });
    expect(rule(runFrameworkChecks(model).findings, "construct-not-in-framework")).toBeUndefined();
  });

  it("reports a hypothesis whose two constructs are drawn but not connected", () => {
    const base = alignedFramework();
    const model = { ...base, relationships: [] };
    const finding = rule(runFrameworkChecks(model).findings, "hypothesis-not-drawn");
    expect(finding?.severity).toBe("warning");
    expect(finding?.targetId).toBe("hyp-a");
  });

  it("reports a direction disagreement between framework and hypothesis", () => {
    const base = alignedFramework();
    const model = {
      ...base,
      relationships: [
        // Drawn outcome -> predictor, the opposite of what H1 states.
        frameworkRelationship({
          id: "fr-a",
          from_node_id: "fn-b",
          to_node_id: "fn-a",
          relation_type: "predicts",
        }),
      ],
    };
    const finding = rule(runFrameworkChecks(model).findings, "direction-mismatch");
    expect(finding?.severity).toBe("warning");
    expect(finding?.remediation).toContain("correct either");
  });

  it("does not call a non-directional relationship a direction disagreement", () => {
    // 'associated_with' claims no direction, so drawing it "the other way"
    // contradicts nothing.
    const base = alignedFramework();
    const model = {
      ...base,
      relationships: [
        frameworkRelationship({
          id: "fr-a",
          from_node_id: "fn-b",
          to_node_id: "fn-a",
          relation_type: "associated_with",
        }),
      ],
    };
    const { findings } = runFrameworkChecks(model);
    expect(rule(findings, "direction-mismatch")).toBeUndefined();
    expect(rule(findings, "hypothesis-not-drawn")).toBeUndefined();
  });

  it("stays quiet about a hypothesis that does not name both ends", () => {
    // Phase 18 already reports an incomplete hypothesis. Saying it again here
    // would double-report the same gap in two workspaces.
    const base = alignedFramework();
    const model = {
      ...base,
      relationships: [],
      methodology: {
        ...base.methodology,
        hypothesisVariables: [
          hypothesisVariable({ hypothesis_id: "hyp-a", construct_id: "con-a", position: "predictor" }),
        ],
      },
    };
    expect(rule(runFrameworkChecks(model).findings, "hypothesis-not-drawn")).toBeUndefined();
  });

  it("reports a relationship whose hypothesis was deleted", () => {
    const base = alignedFramework();
    const model = {
      ...base,
      relationships: [
        frameworkRelationship({
          id: "fr-a",
          from_node_id: "fn-a",
          to_node_id: "fn-b",
          hypothesis_id: "hyp-gone",
        }),
      ],
    };
    const finding = rule(runFrameworkChecks(model).findings, "relationship-hypothesis-missing");
    expect(finding?.severity).toBe("warning");
    expect(finding?.targetType).toBe("framework_relationship");
  });
});

describe("measurement and hypothesis coverage (§9)", () => {
  it("reports a framework construct nothing measures", () => {
    const base = alignedFramework();
    const model = { ...base, methodology: { ...base.methodology, items: [] } };
    const finding = runFrameworkChecks(model).findings.find((f) =>
      f.id.startsWith("framework:construct-not-measured:"),
    );
    expect(finding?.category).toBe("questionnaire");
    expect(finding?.severity).toBe("warning");
  });

  it("counts an item mapped through an indicator as measurement", () => {
    // Checking only the direct construct mapping would report a properly
    // operationalised construct as unmeasured.
    const c = construct({ id: "con-a", role: "independent" });
    const ind = indicator({ id: "ind-a", construct_id: "con-a" });
    const model = frameworkModel({
      nodes: [frameworkNode({ id: "fn-a", construct_id: "con-a" })],
      methodology: {
        ...frameworkModel().methodology,
        constructs: [c],
        indicators: [ind],
        items: [item({ construct_id: null, indicator_id: "ind-a" })],
      },
    });
    const finding = runFrameworkChecks(model).findings.find((f) =>
      f.id.startsWith("framework:construct-not-measured:"),
    );
    expect(finding).toBeUndefined();
  });

  it("reports a framework construct no hypothesis mentions, as info only", () => {
    const base = alignedFramework();
    const extra = construct({ id: "con-c", name: "Class size", role: "control" });
    const model = {
      ...base,
      nodes: [...base.nodes, frameworkNode({ id: "fn-c", construct_id: "con-c" })],
      methodology: {
        ...base.methodology,
        constructs: [...base.methodology.constructs, extra],
        items: [...base.methodology.items, item({ construct_id: "con-c" })],
      },
    };
    const finding = rule(runFrameworkChecks(model).findings, "construct-not-hypothesised");
    expect(finding?.severity).toBe("info");
  });

  it("says nothing about hypothesis coverage in a study with no hypotheses", () => {
    const c = construct({ id: "con-a", role: "independent" });
    const model = frameworkModel({
      nodes: [frameworkNode({ id: "fn-a", construct_id: "con-a" })],
      methodology: {
        ...frameworkModel().methodology,
        constructs: [c],
        items: [item({ construct_id: "con-a" })],
      },
    });
    expect(rule(runFrameworkChecks(model).findings, "construct-not-hypothesised")).toBeUndefined();
  });
});

describe("isolated nodes", () => {
  it("reports a node connected to nothing", () => {
    const base = alignedFramework();
    const model = { ...base, relationships: [] };
    expect(rule(runFrameworkChecks(model).findings, "node-isolated")?.severity).toBe("info");
  });

  it("says nothing about the first node in a new framework", () => {
    // A single node cannot be connected to anything. Firing here would put a
    // finding in front of every researcher the moment they start.
    const model = frameworkModel({
      nodes: [frameworkNode({ id: "fn-a", construct_id: null, label: "Motivation" })],
    });
    expect(rule(runFrameworkChecks(model).findings, "node-isolated")).toBeUndefined();
  });
});

describe("metrics never lie about an empty project (§21, §44)", () => {
  it("reports framework coverage as not computable with no constructs", () => {
    const { metrics } = runFrameworkChecks(frameworkModel());
    const coverage = metrics.find((m) => m.id === "framework_coverage");
    expect(coverage?.value).toBeNull();
    expect(coverage?.status).toBe("not_computable");
  });

  it("reports node binding as not computable with no nodes", () => {
    const { metrics } = runFrameworkChecks(frameworkModel());
    const binding = metrics.find((m) => m.id === "framework_node_binding");
    expect(binding?.value).toBeNull();
    expect(binding?.status).toBe("not_computable");
  });
});

describe("provenance discipline (§23)", () => {
  it("emits only deterministic findings", () => {
    const base = alignedFramework();
    const model = { ...base, relationships: [], methodology: { ...base.methodology, items: [] } };
    const { findings } = runFrameworkChecks(model);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.provenance === "deterministic")).toBe(true);
  });

  it("never raises a framework finding to error", () => {
    // Every framework disagreement is between two things the researcher
    // wrote. The system has no basis to call either one the mistake.
    const base = alignedFramework();
    const model = {
      ...base,
      relationships: [
        frameworkRelationship({ id: "fr-a", from_node_id: "fn-b", to_node_id: "fn-a" }),
      ],
      methodology: { ...base.methodology, items: [] },
    };
    const { findings } = runFrameworkChecks(model);
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("gives every finding a stable id across runs", () => {
    const model = alignedFramework();
    const broken = { ...model, relationships: [] };
    expect(runFrameworkChecks(broken).findings.map((f) => f.id)).toEqual(
      runFrameworkChecks(broken).findings.map((f) => f.id),
    );
  });
});
