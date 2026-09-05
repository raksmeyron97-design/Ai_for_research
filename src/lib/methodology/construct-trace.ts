import type {
  ResearchClaimMethodologyLinkRow,
  ResearchClaimRow,
  ResearchFrameworkNodeRow,
  ResearchFrameworkRelationshipRow,
} from "../db/types";
import type { MethodologyModel } from "./model";

/**
 * Everything one construct is actually connected to (Phase 21 §25).
 *
 * The chain §25 asks for —
 *
 *   Construct → Indicators → Questionnaire items → Hypotheses
 *             → Framework relationships → Claims
 *
 * — already exists as five separate tables and five separate screens. What
 * did not exist was the answer to the question a researcher actually asks
 * about a concept: *what in my study depends on this?* Renaming a construct,
 * or deciding whether it is measured at all, means knowing all of it at once.
 *
 * Pure, and takes rows rather than a client, for the same reason every check
 * since Phase 18 does: fetching decisions stay in one place and the logic is
 * testable without a database.
 *
 * **It reports only stored relationships.** Every link below is a foreign key
 * someone wrote down. Nothing is inferred from name similarity, nothing is
 * guessed from wording, and a missing link is reported as missing rather than
 * filled in — §25 is explicit that fabricating one is worse than showing a
 * gap, because a gap is a thing the researcher can go and fix.
 */
export interface ConstructTrace {
  constructId: string;
  name: string;
  /** The observable parts. A construct with none is not yet measurable. */
  indicators: { id: string; name: string; dimension: string | null }[];
  /**
   * Questionnaire items, grouped by how they reach the construct. An item can
   * name the construct directly or reach it through an indicator, and those
   * are different degrees of evidence that the concept is being asked about.
   */
  items: { id: string; text: string; via: "construct" | "indicator"; indicatorId: string | null }[];
  hypotheses: {
    id: string;
    label: string | null;
    statement: string;
    /** Independent, dependent, mediator... — the position this construct holds
     *  in *this* hypothesis, which lives on the join row because the same
     *  concept can be the predictor in one and the outcome in another. */
    position: string;
  }[];
  /** Framework edges with this construct's node at either end. */
  relationships: {
    id: string;
    relationType: string;
    direction: "from" | "to";
    otherName: string;
    hypothesisId: string | null;
  }[];
  /** Manuscript claims a researcher has linked to this construct. */
  claims: { id: string; text: string; sectionType: string }[];
  /**
   * The gaps, named. Each one is the absence of a stored link, which is a
   * finding about the study rather than about the software — and each is
   * phrased as what is missing, not as a score.
   */
  gaps: string[];
}

export interface ConstructTraceInput {
  methodology: MethodologyModel;
  nodes: ResearchFrameworkNodeRow[];
  relationships: ResearchFrameworkRelationshipRow[];
  claims: ResearchClaimRow[];
  claimLinks: ResearchClaimMethodologyLinkRow[];
}

export function traceConstruct(constructId: string, input: ConstructTraceInput): ConstructTrace | null {
  const { methodology, nodes, relationships, claims, claimLinks } = input;

  const construct = methodology.constructs.find((c) => c.id === constructId);
  if (!construct) return null;

  const indicators = methodology.indicators.filter((i) => i.construct_id === constructId);
  const indicatorIds = new Set(indicators.map((i) => i.id));

  // An item reaching the construct through an indicator is still measuring
  // it; recording *how* it reaches lets the interface say which, rather than
  // flattening two different statements into one list.
  const items = methodology.items
    .filter(
      (item) =>
        item.construct_id === constructId ||
        (item.indicator_id != null && indicatorIds.has(item.indicator_id)),
    )
    .map((item) => ({
      id: item.id,
      text: item.question_text,
      via: (item.construct_id === constructId ? "construct" : "indicator") as "construct" | "indicator",
      indicatorId: item.indicator_id ?? null,
    }));

  // A hypothesis reaches a construct through research_hypothesis_variables,
  // which also carries the position the construct holds in it.
  const variableLinks = methodology.hypothesisVariables.filter((v) => v.construct_id === constructId);
  const hypotheses = variableLinks
    .map((link) => {
      const hypothesis = methodology.hypotheses.find((h) => h.id === link.hypothesis_id);
      if (!hypothesis) return null;
      return {
        id: hypothesis.id,
        label: hypothesis.label,
        statement: hypothesis.statement,
        position: link.position,
      };
    })
    .filter((h): h is NonNullable<typeof h> => h !== null);

  // Framework. The construct's node, then every edge touching it. A node's
  // display name comes from its construct wherever one is linked, so an
  // unmapped endpoint shows its own label rather than a construct's name.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const constructById = new Map(methodology.constructs.map((c) => [c.id, c]));
  const nameOfNode = (nodeId: string): string => {
    const node = nodeById.get(nodeId);
    if (!node) return "(removed concept)";
    const linked = node.construct_id ? constructById.get(node.construct_id) : null;
    return linked?.name ?? node.label ?? "Untitled node";
  };

  const ownNode = nodes.find((n) => n.construct_id === constructId) ?? null;
  const frameworkRelationships = ownNode
    ? relationships
        .filter((rel) => rel.from_node_id === ownNode.id || rel.to_node_id === ownNode.id)
        .map((rel) => {
          const outgoing = rel.from_node_id === ownNode.id;
          return {
            id: rel.id,
            relationType: rel.relation_type,
            direction: (outgoing ? "from" : "to") as "from" | "to",
            otherName: nameOfNode(outgoing ? rel.to_node_id : rel.from_node_id),
            hypothesisId: rel.hypothesis_id,
          };
        })
    : [];

  // Claims. Only through an explicit link a researcher created — never by
  // looking for the construct's name in the manuscript text, which would
  // report a coincidence of wording as a traceable connection.
  const linkedClaimIds = new Set(
    claimLinks.filter((l) => l.construct_id === constructId).map((l) => l.claim_id),
  );
  const linkedClaims = claims
    .filter((c) => linkedClaimIds.has(c.id))
    .map((c) => ({ id: c.id, text: c.claim_text, sectionType: c.section_type }));

  const gaps: string[] = [];
  if (!construct.operational_definition) {
    gaps.push("No operational definition — nothing says how this concept is measured.");
  }
  if (indicators.length === 0) {
    gaps.push("No indicators — this concept has no observable parts a questionnaire item could ask about.");
  }
  if (items.length === 0) {
    gaps.push("No questionnaire item asks about this concept.");
  }
  if (hypotheses.length === 0) {
    gaps.push("No hypothesis involves this concept.");
  }
  if (!ownNode) {
    gaps.push("This concept is not in your conceptual framework.");
  } else if (frameworkRelationships.length === 0) {
    gaps.push("It is in the framework but not related to anything in it.");
  }
  if (linkedClaims.length === 0) {
    gaps.push("No claim in your manuscript is linked to this concept.");
  }

  return {
    constructId,
    name: construct.name,
    indicators: indicators.map((i) => ({ id: i.id, name: i.name, dimension: i.dimension })),
    items,
    hypotheses,
    relationships: frameworkRelationships,
    claims: linkedClaims,
    gaps,
  };
}
