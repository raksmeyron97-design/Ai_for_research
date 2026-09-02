import { describe, expect, it } from "vitest";
import { runConsistencyChecks } from "../../methodology/consistency";
import { buildMetrics } from "../../methodology/consistency";
import { buildCoverageMatrix } from "../../methodology/coverage";
import {
  completeModel,
  construct,
  hypothesis,
  indicator,
  item,
  model,
  objective,
  researchQuestion,
} from "../../methodology/__tests__/fixtures";
import type { MethodologyFinding } from "../../methodology/types";
import type { IntegrityFinding } from "../../integrity/types";
import { fromIntegrityFinding, fromMethodologyFinding } from "../adapters";
import { REVIEW_CATEGORY_LABELS, type ReviewCategory } from "../types";

/**
 * The adapters have a fallback (`?? "methodology"`, `?? "traceability"`). A
 * fallback is the right behaviour at runtime — a finding must never be
 * dropped because a category was added upstream — but it also means a new
 * Phase 18 or Phase 19 category would land silently in the wrong bucket.
 *
 * These tests are what makes that loud: they drive the real engines over a
 * broken project, collect every category they actually emit, and fail if one
 * of them is not mapped explicitly.
 */

/** A project broken in as many ways as the fixtures can express, so the
 *  engines emit a wide spread of categories rather than one. */
function brokenProject() {
  const q = researchQuestion({ id: "rq-a" });
  const orphanObjective = objective({ id: "obj-a", question_id: null });
  const undefinedConstruct = construct({
    id: "con-a",
    conceptual_definition: null,
    operational_definition: null,
  });
  const unmeasured = construct({ id: "con-b", name: "Student performance", role: "dependent" });
  const uncoveredIndicator = indicator({ id: "ind-a", construct_id: "con-a" });
  const looseHypothesis = hypothesis({ id: "hyp-a", objective_id: null, analysis_method: null });

  return model({
    questions: [q],
    objectives: [orphanObjective],
    constructs: [undefinedConstruct, unmeasured],
    indicators: [uncoveredIndicator],
    hypotheses: [looseHypothesis],
    items: [item({ id: "q-a", construct_id: null, indicator_id: null, scale_id: null })],
  });
}

const MAPPED_CATEGORIES = new Set<ReviewCategory>(
  Object.keys(REVIEW_CATEGORY_LABELS) as ReviewCategory[],
);

describe("methodology findings, re-labelled", () => {
  const findings = [
    ...runConsistencyChecks(brokenProject()).findings,
    ...runConsistencyChecks(completeModel()).findings,
  ];

  it("emits enough categories for this to be a real check", () => {
    expect(new Set(findings.map((f) => f.category)).size).toBeGreaterThan(3);
  });

  it("maps every category the engine actually emits", () => {
    // The fallback would hide an unmapped category behind "methodology". This
    // asserts the mapping is explicit by checking the source table directly.
    const unmapped = [...new Set(findings.map((f) => f.category))].filter(
      (category) =>
        !(
          [
            "analysis_plan",
            "construct_naming",
            "definition",
            "hypothesis_structure",
            "hypothesis_traceability",
            "item_wording",
            "measurement_chain",
            "measurement_coverage",
            "measurement_mapping",
            "provenance",
            "question_objective_alignment",
            "redundancy",
            "response_scale",
          ] as string[]
        ).includes(category),
    );
    expect(unmapped).toEqual([]);
  });

  it("produces a valid review category for every finding", () => {
    for (const finding of findings) {
      expect(MAPPED_CATEGORIES.has(fromMethodologyFinding(finding).category)).toBe(true);
    }
  });

  it("namespaces the id so it cannot collide with a Phase 20 finding", () => {
    for (const finding of findings) {
      expect(fromMethodologyFinding(finding).id).toBe(`methodology:${finding.id}`);
    }
  });

  it("preserves severity and target id exactly", () => {
    for (const finding of findings) {
      const converted = fromMethodologyFinding(finding);
      expect(converted.severity).toBe(finding.severity);
      expect(converted.targetId).toBe(finding.targetId);
    }
  });

  it("treats any non-deterministic provenance as a proposal (§23)", () => {
    const base: MethodologyFinding = {
      id: "x",
      category: "definition",
      severity: "warning",
      title: "t",
      explanation: "e",
      provenance: "ai_suggested",
      targetType: "construct",
      targetId: "con-a",
    };
    expect(fromMethodologyFinding(base).provenance).toBe("ai_suggested");
    expect(fromMethodologyFinding({ ...base, provenance: "source_stated" }).provenance).toBe(
      "ai_suggested",
    );
    expect(fromMethodologyFinding({ ...base, provenance: "deterministic" }).provenance).toBe(
      "deterministic",
    );
  });
});

describe("integrity findings, re-labelled", () => {
  const categories: IntegrityFinding["category"][] = [
    "citation",
    "evidence",
    "source",
    "reference",
    "methodology",
    "numerical",
    "provenance",
  ];

  it("maps every category the Phase 19 type allows", () => {
    for (const category of categories) {
      const converted = fromIntegrityFinding({
        id: "x",
        category,
        severity: "warning",
        title: "t",
        explanation: "e",
        targetType: "claim",
        targetId: "clm-1",
        provenance: "deterministic",
      });
      expect(MAPPED_CATEGORIES.has(converted.category)).toBe(true);
      // A silent fallback to "traceability" for a category that should have
      // its own home is the failure this is guarding against.
      if (category !== "citation") expect(converted.category).not.toBe("traceability");
    }
  });

  it("keeps an ai_suggested finding a proposal", () => {
    const converted = fromIntegrityFinding({
      id: "x",
      category: "evidence",
      severity: "warning",
      title: "t",
      explanation: "e",
      targetType: "claim",
      targetId: "clm-1",
      provenance: "ai_suggested",
    });
    expect(converted.provenance).toBe("ai_suggested");
  });
});

describe("metric categories", () => {
  it("covers every metric id the methodology engine produces", () => {
    const metrics = buildMetrics(completeModel(), buildCoverageMatrix(completeModel()));
    const known = new Set([
      "question_alignment",
      "objective_coverage",
      "construct_completeness",
      "variable_traceability",
      "hypothesis_traceability",
      "measurement_coverage",
      "questionnaire_coverage",
      "analysis_coverage",
      "provenance_integrity",
    ]);
    const unknown = metrics.map((m) => m.id).filter((id) => !known.has(id));
    expect(unknown).toEqual([]);
  });
});
