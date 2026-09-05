import type {
  ResearchFrameworkNodeRow,
  ResearchFrameworkRelationshipRow,
} from "../../db/types";
import {
  completeModel,
  construct,
  hypothesis,
  hypothesisVariable,
  indicator,
  item,
  objective,
  scale,
} from "../../methodology/__tests__/fixtures";
import { EMPTY_MODEL, type MethodologyModel } from "../../methodology/model";
import type { FrameworkModel } from "../model";

/**
 * Row builders for the framework engine's tests.
 *
 * Same convention as the methodology fixtures they build on: everything
 * defaults to the *complete, consistent* state, so a test that wants a
 * problem removes one link and reads as "this one thing is wrong".
 */
let counter = 0;
const id = (prefix: string) => `${prefix}-${(counter += 1)}`;

export function frameworkNode(
  over: Partial<ResearchFrameworkNodeRow> = {},
): ResearchFrameworkNodeRow {
  return {
    id: id("fn"),
    project_id: "p1",
    construct_id: "con-a",
    label: null,
    position_x: 0,
    position_y: 0,
    provenance: "user",
    confirmed: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function frameworkRelationship(
  over: Partial<ResearchFrameworkRelationshipRow> = {},
): ResearchFrameworkRelationshipRow {
  return {
    id: id("fr"),
    project_id: "p1",
    from_node_id: "fn-a",
    to_node_id: "fn-b",
    relation_type: "predicts",
    hypothesis_id: null,
    rationale: null,
    provenance: "user",
    confirmed: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function frameworkModel(over: Partial<FrameworkModel> = {}): FrameworkModel {
  return {
    nodes: [],
    relationships: [],
    methodology: EMPTY_MODEL,
    ...over,
  };
}

/**
 * A project whose framework agrees with its methodology in every respect:
 * both constructs are drawn, the relationship runs predictor -> outcome the
 * same way H1 does, and both constructs are measured.
 *
 * Built on `completeModel()` so the two engines' fixtures cannot drift: if
 * Phase 18 changes what "complete" means, this notices.
 */
export function alignedFramework(): FrameworkModel {
  const methodology = completeModel();
  const predictor = frameworkNode({ id: "fn-a", construct_id: "con-a" });
  const outcome = frameworkNode({ id: "fn-b", construct_id: "con-b" });

  return {
    nodes: [predictor, outcome],
    relationships: [
      frameworkRelationship({
        id: "fr-a",
        from_node_id: predictor.id,
        to_node_id: outcome.id,
        relation_type: "predicts",
        hypothesis_id: "hyp-a",
      }),
    ],
    methodology,
  };
}

export { completeModel, construct, hypothesis, hypothesisVariable, indicator, item, objective, scale };
export type { MethodologyModel };
