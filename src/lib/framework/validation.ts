import { DIRECTIONAL_RELATION_TYPES, FRAMEWORK_RELATION_LABELS } from "../db/types";
import type { ReviewFinding, ReviewMetric } from "../review/types";
import { ratioMetric } from "../review/types";
import { resolveNodes, type FrameworkModel, type ResolvedFrameworkNode } from "./model";

/**
 * Deterministic framework checks (§8, §9).
 *
 * Two things this file deliberately does not do.
 *
 * It does not re-check what the database already refuses. Self-loops,
 * duplicate edges, duplicate construct nodes and relationships pointing at a
 * missing node are all prevented by constraints in the Phase 20 migration, so
 * there is nothing here that scans for them — a check that can never fire is
 * a check nobody maintains, and the constraint is the stronger guarantee.
 * §9 lists them; the migration is where they are answered.
 *
 * It does not rewrite anything. §8 is explicit that a direction disagreement
 * between the framework and a hypothesis is flagged for review, never
 * silently corrected — the framework and the hypothesis are both the
 * researcher's, and the system has no basis to decide which one is the
 * mistake.
 */

function isConnected(model: FrameworkModel): Set<string> {
  const connected = new Set<string>();
  for (const rel of model.relationships) {
    connected.add(rel.from_node_id);
    connected.add(rel.to_node_id);
  }
  return connected;
}

/**
 * A node that names no construct. This is the honest replacement for §8's
 * "orphan framework node — claims a construct that no longer exists": with a
 * real foreign key a node *cannot* point at a construct that is gone, so the
 * state that actually occurs is the link being cleared (the FK is
 * `on delete set null`) or never having been made. Both land here, both need
 * the same researcher decision, and §40 forbids guessing the mapping from
 * the label.
 */
function unmappedNodeFindings(resolved: ResolvedFrameworkNode[]): ReviewFinding[] {
  return resolved
    .filter((r) => r.unmapped)
    .map((r) => ({
      id: `framework:node-unmapped:${r.node.id}`,
      category: "framework" as const,
      severity: "warning" as const,
      title: "Framework node is not linked to a construct",
      explanation:
        `"${r.displayName}" is drawn in the framework as free text. Nothing checks it against the ` +
        `methodology, because there is no construct behind it to check against.`,
      targetType: "framework_node" as const,
      targetId: r.node.id,
      provenance: "deterministic" as const,
      remediation: "Link this node to a construct, or create the construct it refers to.",
    }));
}

/** A node connected to nothing. Not an error: a diagram in progress has
 *  unconnected boxes, and calling that a structural failure would fire on
 *  every framework the moment its first node is created. */
function isolatedNodeFindings(
  resolved: ResolvedFrameworkNode[],
  connected: Set<string>,
): ReviewFinding[] {
  // A single node cannot be connected to anything, so the check would fire on
  // a framework that has only just been started. Nothing to say yet.
  if (resolved.length < 2) return [];

  return resolved
    .filter((r) => !connected.has(r.node.id))
    .map((r) => ({
      id: `framework:node-isolated:${r.node.id}`,
      category: "framework" as const,
      severity: "info" as const,
      title: "Framework node has no relationships",
      explanation: `"${r.displayName}" is in the framework but no relationship connects it to anything else.`,
      targetType: "framework_node" as const,
      targetId: r.node.id,
      provenance: "deterministic" as const,
      remediation: "Draw the relationship this concept has to the rest of the framework, or remove the node.",
    }));
}

/**
 * §8's "missing framework node": a construct the methodology declares that
 * the diagram does not show.
 *
 * `latent` constructs are excluded. Phase 18 defines `latent` as "the role of
 * a construct not yet placed in the design" — a construct whose role the
 * researcher has not decided is not yet something the framework is expected
 * to position, and reporting it would turn ordinary work in progress into a
 * finding.
 */
function missingNodeFindings(model: FrameworkModel, resolved: ResolvedFrameworkNode[]): ReviewFinding[] {
  const represented = new Set(
    resolved.filter((r) => r.construct !== null).map((r) => r.construct!.id),
  );

  return model.methodology.constructs
    .filter((c) => c.role !== "latent" && !represented.has(c.id))
    .map((construct) => ({
      id: `framework:construct-not-in-framework:${construct.id}`,
      category: "framework" as const,
      severity: "warning" as const,
      title: "Construct is not in the conceptual framework",
      explanation:
        `"${construct.name}" is declared as a ${construct.role} variable in the methodology, ` +
        `but no framework node represents it.`,
      targetType: "construct" as const,
      targetId: construct.id,
      provenance: "deterministic" as const,
      remediation: "Add a framework node for this construct, or change its role if it is not part of the model.",
    }));
}

/**
 * §8's "hypothesis mismatch" and "relationship mismatch", checked together
 * because both need the same construct-pair index.
 *
 * A hypothesis over two constructs is a directional statement: Phase 18
 * stores which construct is the `predictor` and which the `outcome`. If the
 * framework draws a directional relationship the other way round, one of the
 * two is wrong — and which one is a question only the researcher can answer.
 */
function hypothesisAlignmentFindings(
  model: FrameworkModel,
  resolved: ResolvedFrameworkNode[],
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const nodeByConstruct = new Map(
    resolved.filter((r) => r.construct).map((r) => [r.construct!.id, r]),
  );
  const nodeById = new Map(resolved.map((r) => [r.node.id, r]));
  const hypothesisById = new Map(model.methodology.hypotheses.map((h) => [h.id, h]));

  // The construct pairs the framework actually draws, in both a directed and
  // an undirected form.
  const drawnDirected = new Set<string>();
  const drawnUndirected = new Set<string>();
  for (const rel of model.relationships) {
    const from = nodeById.get(rel.from_node_id);
    const to = nodeById.get(rel.to_node_id);
    if (!from?.construct || !to?.construct) continue;
    drawnDirected.add(`${from.construct.id}->${to.construct.id}`);
    drawnUndirected.add([from.construct.id, to.construct.id].sort().join("|"));
  }

  // --- a hypothesis whose constructs the framework does not connect -------
  const varsByHypothesis = new Map<string, typeof model.methodology.hypothesisVariables>();
  for (const link of model.methodology.hypothesisVariables) {
    const list = varsByHypothesis.get(link.hypothesis_id) ?? [];
    list.push(link);
    varsByHypothesis.set(link.hypothesis_id, list);
  }

  for (const hypothesis of model.methodology.hypotheses) {
    const links = varsByHypothesis.get(hypothesis.id) ?? [];
    const predictors = links.filter((l) => l.position === "predictor");
    const outcomes = links.filter((l) => l.position === "outcome");
    // A hypothesis that does not yet name both ends is Phase 18's finding to
    // report, not this one's — saying it again here would double-report the
    // same incomplete hypothesis in two workspaces.
    if (predictors.length === 0 || outcomes.length === 0) continue;

    for (const predictor of predictors) {
      for (const outcome of outcomes) {
        const bothInFramework =
          nodeByConstruct.has(predictor.construct_id) && nodeByConstruct.has(outcome.construct_id);
        if (!bothInFramework) continue;

        const undirected = [predictor.construct_id, outcome.construct_id].sort().join("|");
        const label = hypothesis.label ?? "This hypothesis";

        if (!drawnUndirected.has(undirected)) {
          findings.push({
            id: `framework:hypothesis-not-drawn:${hypothesis.id}:${predictor.construct_id}:${outcome.construct_id}`,
            category: "framework",
            severity: "warning",
            title: "Hypothesis is not represented in the framework",
            explanation:
              `${label} relates two constructs that both appear in the framework, but no ` +
              `relationship connects them there.`,
            targetType: "hypothesis",
            targetId: hypothesis.id,
            relatedTo: { type: "construct", id: outcome.construct_id },
            provenance: "deterministic",
            remediation: "Draw the relationship in the framework, or check that the hypothesis is still intended.",
          });
        } else if (!drawnDirected.has(`${predictor.construct_id}->${outcome.construct_id}`)) {
          // The pair is connected, but not predictor -> outcome. Only worth
          // saying when the framework's own relationship claims a direction:
          // `associated_with` is explicitly non-directional, so drawing it
          // "the other way" claims nothing and contradicts nothing.
          const reversedDirectional = model.relationships.some((rel) => {
            const from = nodeById.get(rel.from_node_id);
            const to = nodeById.get(rel.to_node_id);
            return (
              from?.construct?.id === outcome.construct_id &&
              to?.construct?.id === predictor.construct_id &&
              DIRECTIONAL_RELATION_TYPES.includes(rel.relation_type)
            );
          });
          if (reversedDirectional) {
            findings.push({
              id: `framework:direction-mismatch:${hypothesis.id}:${predictor.construct_id}:${outcome.construct_id}`,
              category: "framework",
              severity: "warning",
              title: "Framework and hypothesis disagree about direction",
              explanation:
                `${label} treats "${nodeByConstruct.get(predictor.construct_id)!.displayName}" as the ` +
                `predictor and "${nodeByConstruct.get(outcome.construct_id)!.displayName}" as the outcome, ` +
                `but the framework draws the relationship the other way round.`,
              targetType: "hypothesis",
              targetId: hypothesis.id,
              relatedTo: { type: "construct", id: predictor.construct_id },
              provenance: "deterministic",
              remediation:
                "Decide which direction the study claims, then correct either the hypothesis or the framework relationship.",
            });
          }
        }
      }
    }
  }

  // --- a relationship whose hypothesis link went missing ------------------
  // The FK is `on delete set null`, so a deleted hypothesis leaves the drawn
  // relationship in place and merely unlinked. That is a visible state worth
  // reporting: the relationship kept its shape but lost its justification.
  for (const rel of model.relationships) {
    if (rel.hypothesis_id && !hypothesisById.has(rel.hypothesis_id)) {
      const from = nodeById.get(rel.from_node_id);
      const to = nodeById.get(rel.to_node_id);
      findings.push({
        id: `framework:relationship-hypothesis-missing:${rel.id}`,
        category: "framework",
        severity: "warning",
        title: "Relationship names a hypothesis that no longer exists",
        explanation:
          `The relationship "${from?.displayName ?? "?"}" ${FRAMEWORK_RELATION_LABELS[rel.relation_type]} ` +
          `"${to?.displayName ?? "?"}" was justified by a hypothesis that has since been removed.`,
        targetType: "framework_relationship",
        targetId: rel.id,
        provenance: "deterministic",
        remediation: "Link the relationship to a current hypothesis, or remove it.",
      });
    }
  }

  return findings;
}

/**
 * §9's "framework constructs absent from questionnaire" — a concept the model
 * positions but nothing measures.
 *
 * Coverage is read through both routes Phase 18 stores: an item mapped
 * straight to a construct, and an item mapped to an indicator of that
 * construct. Checking only the direct mapping would report a properly
 * operationalised construct as unmeasured.
 */
function measurementFindings(model: FrameworkModel, resolved: ResolvedFrameworkNode[]): ReviewFinding[] {
  const measured = new Set<string>();
  const indicatorConstruct = new Map(
    model.methodology.indicators.map((i) => [i.id, i.construct_id]),
  );

  for (const item of model.methodology.items) {
    if (item.construct_id) measured.add(item.construct_id);
    if (item.indicator_id) {
      const constructId = indicatorConstruct.get(item.indicator_id);
      if (constructId) measured.add(constructId);
    }
  }

  return resolved
    .filter((r) => r.construct && !measured.has(r.construct.id))
    .map((r) => ({
      id: `framework:construct-not-measured:${r.construct!.id}`,
      category: "questionnaire" as const,
      severity: "warning" as const,
      title: "Framework construct is not measured",
      explanation:
        `"${r.displayName}" is positioned in the conceptual framework, but no questionnaire item ` +
        `measures it, directly or through an indicator.`,
      targetType: "construct" as const,
      targetId: r.construct!.id,
      relatedTo: { type: "framework_node", id: r.node.id },
      provenance: "deterministic" as const,
      remediation: "Add an indicator and a questionnaire item for this construct, or remove it from the framework.",
    }));
}

/** §9's "framework constructs absent from hypotheses". Info, not warning: a
 *  descriptive study legitimately has framework constructs no hypothesis
 *  mentions, so this is an opportunity to check, not a defect. */
function hypothesisCoverageFindings(
  model: FrameworkModel,
  resolved: ResolvedFrameworkNode[],
): ReviewFinding[] {
  // Nothing to say about hypothesis coverage in a study that has not written
  // any hypotheses — that is a design choice, not an omission.
  if (model.methodology.hypotheses.length === 0) return [];

  const inHypothesis = new Set(model.methodology.hypothesisVariables.map((v) => v.construct_id));

  return resolved
    .filter((r) => r.construct && !inHypothesis.has(r.construct.id))
    .map((r) => ({
      id: `framework:construct-not-hypothesised:${r.construct!.id}`,
      category: "framework" as const,
      severity: "info" as const,
      title: "Framework construct appears in no hypothesis",
      explanation: `"${r.displayName}" is in the framework, but no hypothesis refers to it.`,
      targetType: "construct" as const,
      targetId: r.construct!.id,
      relatedTo: { type: "framework_node", id: r.node.id },
      provenance: "deterministic" as const,
      remediation: "Add a hypothesis covering this construct, or confirm it is descriptive only.",
    }));
}

export function runFrameworkChecks(model: FrameworkModel): {
  findings: ReviewFinding[];
  metrics: ReviewMetric[];
} {
  const resolved = resolveNodes(model);
  const connected = isConnected(model);

  const findings = [
    ...unmappedNodeFindings(resolved),
    ...isolatedNodeFindings(resolved, connected),
    ...missingNodeFindings(model, resolved),
    ...hypothesisAlignmentFindings(model, resolved),
    ...measurementFindings(model, resolved),
    ...hypothesisCoverageFindings(model, resolved),
  ];

  const positioned = model.methodology.constructs.filter((c) => c.role !== "latent");
  const represented = new Set(resolved.filter((r) => r.construct).map((r) => r.construct!.id));

  const metrics: ReviewMetric[] = [
    ratioMetric(
      positioned.filter((c) => represented.has(c.id)).length,
      positioned.length,
      {
        id: "framework_coverage",
        label: "Framework coverage",
        category: "framework",
        ok: "Constructs with an assigned role that appear as a node in the conceptual framework.",
        empty: "No constructs have been given a role yet, so there is nothing the framework should show.",
      },
    ),
    ratioMetric(
      resolved.filter((r) => !r.unmapped).length,
      resolved.length,
      {
        id: "framework_node_binding",
        label: "Framework nodes linked to constructs",
        category: "framework",
        ok: "Framework nodes that name a canonical construct rather than free text.",
        empty: "The conceptual framework has no nodes yet.",
      },
    ),
  ];

  return { findings, metrics };
}
