import { describe, expect, it } from "vitest";
import { buildGraph, danglingEdges, nodeId, orphanNodes } from "../graph";
import { buildCoverageMatrix } from "../coverage";
import { completeModel, construct, indicator, item, model, researchQuestion } from "./fixtures";

describe("buildGraph", () => {
  it("draws an edge for every stored link and no others", () => {
    const graph = buildGraph(completeModel());
    const kinds = graph.edges.map((e) => e.kind).sort();
    expect(kinds).toEqual([
      "construct_indicator",
      "construct_indicator",
      "hypothesis_construct",
      "hypothesis_construct",
      "indicator_item",
      "indicator_item",
      "objective_hypothesis",
      "question_objective",
    ]);
  });

  // An item reaches its construct through its indicator. Drawing both edges
  // would double-count the item in every construct-level total.
  it("does not draw a construct edge for an item that already has an indicator", () => {
    const graph = buildGraph(completeModel());
    expect(graph.edges.some((e) => e.kind === "construct_item")).toBe(false);
  });

  it("draws a construct edge when the item has no indicator", () => {
    const c = construct({ id: "con-a" });
    const graph = buildGraph(
      model({ constructs: [c], items: [item({ id: "q-a", construct_id: c.id, indicator_id: null })] }),
    );
    expect(graph.edges).toContainEqual({
      from: nodeId("construct", c.id),
      to: nodeId("questionnaire_item", "q-a"),
      kind: "construct_item",
    });
  });

  it("never infers an edge from similar names", () => {
    const graph = buildGraph(
      model({
        constructs: [construct({ id: "con-a", name: "Teacher motivation" })],
        items: [
          item({ id: "q-a", construct_id: null, indicator_id: null, construct: "Teacher motivation" }),
        ],
      }),
    );
    expect(graph.edges).toEqual([]);
  });

  it("carries the hypothesis position on the edge", () => {
    const graph = buildGraph(completeModel());
    const positions = graph.edges.filter((e) => e.kind === "hypothesis_construct").map((e) => e.detail);
    expect(positions.sort()).toEqual(["outcome", "predictor"]);
  });
});

describe("orphanNodes", () => {
  it("finds a question connected to nothing", () => {
    const graph = buildGraph(model({ questions: [researchQuestion({ id: "rq-a" })] }));
    expect(orphanNodes(graph).map((n) => n.id)).toEqual([nodeId("research_question", "rq-a")]);
  });

  it("finds nothing in a fully linked model", () => {
    expect(orphanNodes(buildGraph(completeModel()))).toEqual([]);
  });
});

describe("danglingEdges", () => {
  it("is empty for a model built from stored rows", () => {
    expect(danglingEdges(buildGraph(completeModel()))).toEqual([]);
  });
});

describe("buildCoverageMatrix", () => {
  it("lists an indicator with no item as uncovered", () => {
    const c = construct({ id: "con-a" });
    const covered = indicator({ id: "ind-a", construct_id: c.id });
    const bare = indicator({ id: "ind-b", construct_id: c.id, name: "Effort" });
    const matrix = buildCoverageMatrix(
      model({
        constructs: [c],
        indicators: [covered, bare],
        items: [item({ id: "q-a", construct_id: c.id, indicator_id: covered.id })],
      }),
    );
    expect(matrix.uncoveredIndicatorIds).toEqual([bare.id]);
    expect(matrix.constructs[0].fullyCovered).toBe(false);
  });

  it("separates orphan items from construct-only items", () => {
    const c = construct({ id: "con-a" });
    const matrix = buildCoverageMatrix(
      model({
        constructs: [c],
        items: [
          item({ id: "q-a", construct_id: c.id, indicator_id: null }),
          item({ id: "q-b", construct_id: null, indicator_id: null }),
        ],
      }),
    );
    expect(matrix.constructs[0].unassignedItems.map((i) => i.id)).toEqual(["q-a"]);
    expect(matrix.orphanItems.map((i) => i.id)).toEqual(["q-b"]);
    expect(matrix.counts.mappedItems).toBe(1);
  });

  // Nothing to cover is not the same as everything covered.
  it("does not call a construct with no indicators fully covered", () => {
    const matrix = buildCoverageMatrix(model({ constructs: [construct({ id: "con-a" })] }));
    expect(matrix.constructs[0].fullyCovered).toBe(false);
  });
});
