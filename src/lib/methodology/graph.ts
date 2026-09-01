import { CONSTRUCT_ROLE_LABELS } from "../db/types";
import type { MethodologyModel } from "./model";
import type { MethodologyEdge, MethodologyGraph, MethodologyNode } from "./types";

/**
 * The methodology graph (§13).
 *
 * Every edge exists because a stored foreign key exists. Nothing here infers a
 * relationship from wording, which is the property that makes a *missing* edge
 * a fact rather than an opinion — "no questionnaire item measures this
 * indicator" is checkable, and a graph that guessed edges from similar names
 * would quietly hide exactly the gaps this is built to surface.
 */
export function nodeId(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export function buildGraph(model: MethodologyModel): MethodologyGraph {
  const nodes: MethodologyNode[] = [];
  const edges: MethodologyEdge[] = [];

  for (const question of model.questions) {
    nodes.push({
      id: nodeId("research_question", question.id),
      kind: "research_question",
      label: question.question_text,
      provenance: question.provenance,
      detail: question.question_kind,
    });
  }

  for (const objective of model.objectives) {
    nodes.push({
      id: nodeId("objective", objective.id),
      kind: "objective",
      label: objective.objective_text,
      provenance: objective.provenance,
    });
    if (objective.question_id) {
      edges.push({
        from: nodeId("research_question", objective.question_id),
        to: nodeId("objective", objective.id),
        kind: "question_objective",
      });
    }
  }

  for (const construct of model.constructs) {
    nodes.push({
      id: nodeId("construct", construct.id),
      kind: "construct",
      label: construct.name,
      provenance: construct.provenance,
      detail: CONSTRUCT_ROLE_LABELS[construct.role],
    });
  }

  for (const indicator of model.indicators) {
    nodes.push({
      id: nodeId("indicator", indicator.id),
      kind: "indicator",
      label: indicator.name,
      provenance: indicator.provenance,
      detail: indicator.dimension ?? undefined,
    });
    edges.push({
      from: nodeId("construct", indicator.construct_id),
      to: nodeId("indicator", indicator.id),
      kind: "construct_indicator",
    });
  }

  for (const hypothesis of model.hypotheses) {
    nodes.push({
      id: nodeId("hypothesis", hypothesis.id),
      kind: "hypothesis",
      label: hypothesis.label ? `${hypothesis.label}: ${hypothesis.statement}` : hypothesis.statement,
      provenance: hypothesis.provenance,
      detail: hypothesis.hypothesis_form,
    });
    if (hypothesis.objective_id) {
      edges.push({
        from: nodeId("objective", hypothesis.objective_id),
        to: nodeId("hypothesis", hypothesis.id),
        kind: "objective_hypothesis",
      });
    }
    if (hypothesis.question_id) {
      edges.push({
        from: nodeId("research_question", hypothesis.question_id),
        to: nodeId("hypothesis", hypothesis.id),
        kind: "question_hypothesis",
      });
    }
  }

  for (const link of model.hypothesisVariables) {
    edges.push({
      from: nodeId("hypothesis", link.hypothesis_id),
      to: nodeId("construct", link.construct_id),
      kind: "hypothesis_construct",
      detail: link.position,
    });
  }

  for (const item of model.items) {
    nodes.push({
      id: nodeId("questionnaire_item", item.id),
      kind: "questionnaire_item",
      label: item.question_text,
      provenance: item.item_provenance,
      detail: item.response_type,
    });
    if (item.indicator_id) {
      edges.push({
        from: nodeId("indicator", item.indicator_id),
        to: nodeId("questionnaire_item", item.id),
        kind: "indicator_item",
      });
    } else if (item.construct_id) {
      // Only when there is no indicator link: an item that measures an
      // indicator already reaches its construct through it, and drawing both
      // would double-count the item in every construct-level total.
      edges.push({
        from: nodeId("construct", item.construct_id),
        to: nodeId("questionnaire_item", item.id),
        kind: "construct_item",
      });
    }
  }

  return { nodes, edges };
}

/** Nodes with no edge at all — reachable from nothing and reaching nothing. */
export function orphanNodes(graph: MethodologyGraph): MethodologyNode[] {
  const touched = new Set<string>();
  for (const edge of graph.edges) {
    touched.add(edge.from);
    touched.add(edge.to);
  }
  return graph.nodes.filter((node) => !touched.has(node.id));
}

/** Edges pointing at a node that is not in the graph. */
export function danglingEdges(graph: MethodologyGraph): MethodologyEdge[] {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return graph.edges.filter((edge) => !ids.has(edge.from) || !ids.has(edge.to));
}
