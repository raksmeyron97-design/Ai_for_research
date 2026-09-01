import { describe, expect, it } from "vitest";
import { validateFramework } from "../framework-validation";
import type { FrameworkGraph } from "../../db/types";

function node(id: string, label: string, role: FrameworkGraph["nodes"][number]["role"], ai = false) {
  return { id, label, role, ai_suggested: ai };
}
function edge(id: string, from: string, to: string) {
  return { id, from, to, rationale: "", ai_suggested: false };
}

const kinds = (g: FrameworkGraph) => validateFramework(g).issues.map((i) => i.kind);

describe("framework structural validation", () => {
  it("accepts a well-formed framework", () => {
    const graph: FrameworkGraph = {
      nodes: [node("p", "Pregnant women", "population"), node("e", "Social support", "exposure"), node("o", "Depressive symptoms", "outcome")],
      edges: [edge("e1", "p", "e"), edge("e2", "e", "o")],
    };
    expect(validateFramework(graph).issues).toEqual([]);
  });

  it("flags a node connected to nothing", () => {
    const graph: FrameworkGraph = {
      nodes: [node("e", "Support", "exposure"), node("o", "Symptoms", "outcome"), node("x", "Parity", "covariate")],
      edges: [edge("e1", "e", "o")],
    };
    expect(kinds(graph)).toContain("orphan_node");
  });

  it("flags an outcome nothing points to — the diagram looks complete but explains nothing", () => {
    const graph: FrameworkGraph = {
      nodes: [node("e", "Support", "exposure"), node("o", "Symptoms", "outcome")],
      edges: [edge("e1", "o", "e")],
    };
    expect(kinds(graph)).toContain("disconnected_outcome");
  });

  it("flags a framework with no outcome at all", () => {
    const graph: FrameworkGraph = {
      nodes: [node("a", "Support", "exposure"), node("b", "Parity", "covariate")],
      edges: [edge("e1", "a", "b")],
    };
    expect(kinds(graph)).toContain("no_outcome");
  });

  it("flags duplicate nodes of the same role, ignoring case and spacing", () => {
    const graph: FrameworkGraph = {
      nodes: [node("a", "Social Support", "exposure"), node("b", "social  support", "exposure"), node("o", "Symptoms", "outcome")],
      edges: [edge("e1", "a", "o"), edge("e2", "b", "o")],
    };
    expect(kinds(graph)).toContain("duplicate_node");
  });

  it("flags a duplicated relationship", () => {
    const graph: FrameworkGraph = {
      nodes: [node("a", "Support", "exposure"), node("o", "Symptoms", "outcome")],
      edges: [edge("e1", "a", "o"), edge("e2", "a", "o")],
    };
    expect(kinds(graph)).toContain("duplicate_edge");
  });

  it("flags a self-loop", () => {
    const graph: FrameworkGraph = {
      nodes: [node("a", "Support", "exposure"), node("o", "Symptoms", "outcome")],
      edges: [edge("e1", "a", "a"), edge("e2", "a", "o")],
    };
    expect(kinds(graph)).toContain("self_loop");
  });

  it("flags an edge pointing at a deleted node, and does not let it corrupt other checks", () => {
    const graph: FrameworkGraph = {
      nodes: [node("a", "Support", "exposure"), node("o", "Symptoms", "outcome")],
      edges: [edge("e1", "a", "o"), edge("e2", "a", "ghost")],
    };
    const issues = validateFramework(graph).issues;
    expect(issues.map((i) => i.kind)).toContain("dangling_edge");
    // The valid edge still counts, so neither real node is reported orphaned.
    expect(issues.map((i) => i.kind)).not.toContain("orphan_node");
  });

  it("flags a declared variable missing from the framework", () => {
    const graph: FrameworkGraph = {
      nodes: [node("a", "Social support", "exposure"), node("o", "Symptoms", "outcome")],
      edges: [edge("e1", "a", "o")],
    };
    const result = validateFramework(graph, { variables: ["Social support", "Parity"] });
    expect(result.issues.filter((i) => i.kind === "variable_not_represented")).toHaveLength(1);
    expect(result.issues[0].message).toContain("Parity");
  });

  it("flags an objective with no obviously related node", () => {
    const graph: FrameworkGraph = {
      nodes: [node("a", "Social support", "exposure"), node("o", "Depressive symptoms", "outcome")],
      edges: [edge("e1", "a", "o")],
    };
    const result = validateFramework(graph, { objectives: ["Assess nutritional adequacy of diet"] });
    expect(result.issues.map((i) => i.kind)).toContain("objective_not_represented");
  });

  it("does not flag an objective that is represented", () => {
    const graph: FrameworkGraph = {
      nodes: [node("a", "Social support", "exposure"), node("o", "Depressive symptoms", "outcome")],
      edges: [edge("e1", "a", "o")],
    };
    const result = validateFramework(graph, { objectives: ["Examine social support and depressive symptoms"] });
    expect(result.issues.map((i) => i.kind)).not.toContain("objective_not_represented");
  });

  it("reports an empty framework as having nothing wrong rather than inventing issues", () => {
    expect(validateFramework({ nodes: [], edges: [] }).issues).toEqual([]);
  });

  it("says what it checked, so a clean result is not read as scientific endorsement", () => {
    const result = validateFramework({ nodes: [], edges: [] });
    expect(result.checked.length).toBeGreaterThan(3);
  });
});
