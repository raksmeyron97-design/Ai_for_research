import type {
  ResearchFrameworkNodeRow,
  ResearchFrameworkRelationshipRow,
} from "../db/types";
import type { MethodologyModel } from "../methodology/model";

/**
 * Everything the framework checks reason over (Phase 20).
 *
 * The framework is deliberately *not* a self-contained graph: its nodes are
 * pointers into the Phase 18 methodology model, so validating it means
 * validating it against that model. Bundling the two here keeps the checks
 * pure — nothing in `validation.ts` touches the database — and keeps every
 * fetching decision in `review-service.ts`, the same discipline Phase 18 and
 * Phase 19 already follow.
 */
export interface FrameworkModel {
  nodes: ResearchFrameworkNodeRow[];
  relationships: ResearchFrameworkRelationshipRow[];
  methodology: MethodologyModel;
}

/**
 * A node resolved against the methodology model — what the UI renders and
 * what every check reads instead of re-joining by hand.
 *
 * `displayName` is the construct's name whenever the node is mapped. The
 * node's own `label` is only used when there is no construct, which is what
 * keeps a stale legacy label from silently overriding the canonical name
 * after a construct is renamed.
 */
export interface ResolvedFrameworkNode {
  node: ResearchFrameworkNodeRow;
  construct: MethodologyModel["constructs"][number] | null;
  /** True when the node names no construct: legacy free text, or a construct
   *  that was deleted out from under it. Requires a researcher decision (§40). */
  unmapped: boolean;
  displayName: string;
}

export function resolveNodes(model: FrameworkModel): ResolvedFrameworkNode[] {
  const constructsById = new Map(model.methodology.constructs.map((c) => [c.id, c]));

  return model.nodes.map((node) => {
    const construct = node.construct_id ? constructsById.get(node.construct_id) ?? null : null;
    return {
      node,
      construct,
      unmapped: construct === null,
      // A node always has one of the two — the database check constraint
      // `research_framework_nodes_identifiable` guarantees it — so the final
      // fallback is unreachable in practice and exists so the type is total.
      displayName: construct?.name ?? node.label ?? "Untitled node",
    };
  });
}
