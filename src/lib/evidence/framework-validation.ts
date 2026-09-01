import type { FrameworkGraph } from "../db/types";

/**
 * Structural validation for a conceptual framework (§20).
 *
 * Every check here is about the *shape* of the graph — orphans, disconnected
 * outcomes, duplicates, coverage of the declared variables and objectives.
 * None of it says the framework is scientifically correct, and §20 is explicit
 * that passing these checks does not mean it is. A framework can be perfectly
 * connected and still model the wrong thing, so the summary says what was
 * actually checked rather than issuing a verdict.
 */
export type FrameworkIssueKind =
  | "orphan_node"
  | "disconnected_outcome"
  | "duplicate_node"
  | "duplicate_edge"
  | "self_loop"
  | "dangling_edge"
  | "variable_not_represented"
  | "objective_not_represented"
  | "no_outcome";

export interface FrameworkIssue {
  kind: FrameworkIssueKind;
  severity: "high" | "medium" | "low";
  message: string;
  /** Node or edge id the issue concerns, when it concerns one. */
  target?: string;
}

export interface FrameworkValidation {
  issues: FrameworkIssue[];
  /** What was checked — so a clean result is not mistaken for scientific endorsement. */
  checked: string[];
}

function normalise(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export function validateFramework(
  graph: FrameworkGraph,
  context: { variables?: string[]; objectives?: string[] } = {},
): FrameworkValidation {
  const issues: FrameworkIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  // --- duplicates -------------------------------------------------------
  const seenLabels = new Map<string, string>();
  for (const node of graph.nodes) {
    const key = `${node.role}:${normalise(node.label)}`;
    const existing = seenLabels.get(key);
    if (existing) {
      issues.push({
        kind: "duplicate_node",
        severity: "medium",
        message: `"${node.label}" appears more than once as a ${node.role}.`,
        target: node.id,
      });
    } else {
      seenLabels.set(key, node.id);
    }
  }

  const seenEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to) {
      issues.push({
        kind: "self_loop",
        severity: "medium",
        message: "A variable is connected to itself.",
        target: edge.id,
      });
      continue;
    }
    // A dangling edge would make every downstream check wrong, so it is
    // reported and then skipped rather than silently dropped.
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push({
        kind: "dangling_edge",
        severity: "high",
        message: "A relationship points at a node that no longer exists.",
        target: edge.id,
      });
      continue;
    }
    const key = `${edge.from}->${edge.to}`;
    if (seenEdges.has(key)) {
      issues.push({
        kind: "duplicate_edge",
        severity: "low",
        message: "The same relationship is drawn twice.",
        target: edge.id,
      });
    }
    seenEdges.add(key);
  }

  // --- connectivity -----------------------------------------------------
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to) {
      connected.add(edge.from);
      connected.add(edge.to);
    }
  }

  for (const node of graph.nodes) {
    if (!connected.has(node.id)) {
      issues.push({
        kind: "orphan_node",
        severity: node.role === "outcome" ? "high" : "medium",
        message: `"${node.label}" is not connected to anything.`,
        target: node.id,
      });
    }
  }

  const outcomes = graph.nodes.filter((n) => n.role === "outcome");
  if (graph.nodes.length > 0 && outcomes.length === 0) {
    issues.push({
      kind: "no_outcome",
      severity: "high",
      message: "The framework has no outcome variable, so nothing is being explained.",
    });
  }

  // An outcome with no arrow *into* it is a specific and common mistake:
  // the diagram looks complete but nothing is said to influence the outcome.
  const hasIncoming = new Set(graph.edges.map((e) => e.to));
  for (const outcome of outcomes) {
    if (connected.has(outcome.id) && !hasIncoming.has(outcome.id)) {
      issues.push({
        kind: "disconnected_outcome",
        severity: "high",
        message: `Nothing points to the outcome "${outcome.label}".`,
        target: outcome.id,
      });
    }
  }

  // --- coverage of declared research content ----------------------------
  const labels = new Set(graph.nodes.map((n) => normalise(n.label)));

  for (const variable of context.variables ?? []) {
    if (!labels.has(normalise(variable))) {
      issues.push({
        kind: "variable_not_represented",
        severity: "medium",
        message: `The variable "${variable}" does not appear in the framework.`,
      });
    }
  }

  for (const objective of context.objectives ?? []) {
    // Objectives are prose, so this is a containment check rather than an
    // equality one: a heuristic that flags a possible omission, not proof of
    // one.
    const words = normalise(objective).split(" ").filter((w) => w.length > 4);
    const represented = words.some((w) => [...labels].some((l) => l.includes(w)));
    if (words.length > 0 && !represented) {
      issues.push({
        kind: "objective_not_represented",
        severity: "low",
        message: `No framework node obviously relates to the objective "${objective.slice(0, 60)}".`,
      });
    }
  }

  return {
    issues,
    checked: [
      "duplicate nodes and relationships",
      "self-loops and relationships pointing at missing nodes",
      "nodes connected to nothing",
      "presence of an outcome, and whether anything points to it",
      "whether declared variables appear as nodes",
      "whether objectives are obviously represented",
    ],
  };
}
