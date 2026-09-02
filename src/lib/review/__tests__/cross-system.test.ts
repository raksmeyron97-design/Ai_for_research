import { describe, expect, it } from "vitest";
import type { ResearchClaimRow, ResearchEvidenceRow } from "../../db/types";
import { completeModel } from "../../methodology/__tests__/fixtures";
import { EMPTY_MODEL } from "../../methodology/model";
import { runCrossSystemChecks } from "../cross-system";
import { ratioMetric, sortFindings, type ReviewFinding } from "../types";

function claim(over: Partial<ResearchClaimRow> = {}): ResearchClaimRow {
  return {
    id: "clm-1",
    project_id: "p1",
    section_type: "results",
    claim_text: "Teacher motivation predicted performance.",
    claim_type: "factual",
    evidence_status: "SUPPORTED",
    citation_key: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as ResearchClaimRow;
}

function evidence(over: Partial<ResearchEvidenceRow> = {}): ResearchEvidenceRow {
  return {
    id: "ev-1",
    project_id: "p1",
    citation_id: "cit-1",
    document_id: null,
    chunk_id: null,
    excerpt: "Motivation correlated with outcomes (r = .42).",
    page: null,
    section_label: null,
    relevance_note: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  } as ResearchEvidenceRow;
}

function run(over: Partial<Parameters<typeof runCrossSystemChecks>[0]> = {}) {
  return runCrossSystemChecks({
    claims: [],
    evidence: [],
    claimEvidence: [],
    methodologyLinks: [],
    methodology: EMPTY_MODEL,
    ...over,
  });
}

function rule(findings: ReviewFinding[], name: string): ReviewFinding | undefined {
  return findings.find((f) => f.id.startsWith(`traceability:${name}:`));
}

describe("evidence that supports nothing", () => {
  it("reports a saved excerpt no claim uses", () => {
    const finding = rule(run({ evidence: [evidence()] }).findings, "evidence-supports-nothing");
    expect(finding?.severity).toBe("info");
    expect(finding?.category).toBe("evidence");
    expect(finding?.relatedTo).toEqual({ type: "source", id: "cit-1" });
  });

  it("stays quiet once a claim links to it", () => {
    const result = run({
      evidence: [evidence()],
      claimEvidence: [{ evidence_id: "ev-1" }],
    });
    expect(rule(result.findings, "evidence-supports-nothing")).toBeUndefined();
  });

  it("truncates a long excerpt rather than pasting the whole thing", () => {
    const long = "x".repeat(400);
    const finding = rule(
      run({ evidence: [evidence({ excerpt: long })] }).findings,
      "evidence-supports-nothing",
    );
    expect(finding!.explanation.length).toBeLessThan(300);
    expect(finding!.explanation).toContain("…");
  });
});

describe("claims not linked to the methodology (§16's reverse direction)", () => {
  it("reports a results claim tied to no construct or hypothesis", () => {
    const finding = rule(
      run({ claims: [claim()], methodology: completeModel() }).findings,
      "claim-not-linked-to-methodology",
    );
    expect(finding?.severity).toBe("info");
    expect(finding?.targetId).toBe("clm-1");
  });

  it("stays quiet once the claim is linked", () => {
    const result = run({
      claims: [claim()],
      methodologyLinks: [{ claim_id: "clm-1" }],
      methodology: completeModel(),
    });
    expect(rule(result.findings, "claim-not-linked-to-methodology")).toBeUndefined();
  });

  it("does not ask a background-chapter claim to be about this study", () => {
    // A claim about someone else's work is the point of the background chapters.
    const result = run({
      claims: [claim({ section_type: "rationale" })],
      methodology: completeModel(),
    });
    expect(rule(result.findings, "claim-not-linked-to-methodology")).toBeUndefined();
  });

  it("says nothing when there is no methodology to link to", () => {
    // The finding would be about the empty methodology, not about the claim,
    // and Phase 18 already reports that.
    const result = run({ claims: [claim()], methodology: EMPTY_MODEL });
    expect(rule(result.findings, "claim-not-linked-to-methodology")).toBeUndefined();
  });
});

describe("metrics", () => {
  it("reports both as not computable for an empty project", () => {
    const { metrics } = run();
    expect(metrics.every((m) => m.value === null && m.status === "not_computable")).toBe(true);
  });

  it("counts evidence utilisation over saved excerpts", () => {
    const { metrics } = run({
      evidence: [evidence({ id: "ev-1" }), evidence({ id: "ev-2" })],
      claimEvidence: [{ evidence_id: "ev-1" }],
    });
    const metric = metrics.find((m) => m.id === "evidence_utilisation");
    expect(metric?.value).toBe(0.5);
    expect(metric?.evidence).toEqual({ covered: 1, total: 2 });
  });
});

describe("the shared review contract", () => {
  it("never turns an empty denominator into a score", () => {
    // "No constructs, therefore perfect coverage" and "no constructs,
    // therefore zero coverage" are both lies about an empty project.
    const metric = ratioMetric(0, 0, {
      id: "m",
      label: "M",
      category: "framework",
      ok: "ok",
      empty: "nothing yet",
    });
    expect(metric.value).toBeNull();
    expect(metric.status).toBe("not_computable");
    expect(metric.evidence).toBeUndefined();
  });

  it("orders findings by severity and then stably by id", () => {
    const make = (id: string, severity: ReviewFinding["severity"]): ReviewFinding => ({
      id,
      category: "framework",
      severity,
      title: "t",
      explanation: "e",
      targetType: "project",
      targetId: "p1",
      provenance: "deterministic",
    });
    const sorted = sortFindings([
      make("z", "info"),
      make("b", "error"),
      make("a", "warning"),
      make("a2", "error"),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(["a2", "b", "a", "z"]);
  });
});
