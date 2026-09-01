import { describe, expect, it } from "vitest";
import { reviewSection, type SectionReviewInput } from "../section-review";
import type { ResearchClaimRow, SectionType } from "../../db/types";

function claim(over: Partial<ResearchClaimRow> = {}): ResearchClaimRow {
  return {
    id: "c1",
    project_id: "p1",
    section_type: "research_problem",
    claim_text: "Postpartum depression affects maternal wellbeing.",
    claim_type: "factual",
    needs_evidence: true,
    evidence_status: "NEEDS_VERIFICATION",
    source_offset_start: null,
    source_offset_end: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function input(over: Partial<SectionReviewInput> = {}): SectionReviewInput {
  return {
    section: "research_problem" as SectionType,
    sectionRow: {
      id: "s1",
      project_id: "p1",
      section_type: "research_problem",
      content: "word ".repeat(300),
      status: "in_progress",
      metadata: {},
      created_at: "",
      updated_at: "",
    },
    claims: [],
    presentPriorSections: ["title"],
    resolvedCitationKeys: [],
    unresolvedCitationKeys: [],
    ...over,
  };
}

/**
 * Phase 17 §16-§18: every score must be derived from a countable check, and
 * must be able to explain itself.
 */
describe("section health scores", () => {
  it("explains every score it reports", () => {
    const health = reviewSection(input());
    for (const key of ["completeness", "evidenceCoverage", "researchAlignment", "citationIntegrity"]) {
      expect(health.explanations[key], `${key} has no explanation`).toBeTruthy();
    }
  });

  it("caps completeness at 100% rather than rewarding padding", () => {
    const health = reviewSection(input({ sectionRow: { ...input().sectionRow!, content: "word ".repeat(5000) } }));
    expect(health.completeness).toBe(1);
  });

  it("counts Khmer content, which has no inter-word spaces", () => {
    const khmer = reviewSection(
      input({ sectionRow: { ...input().sectionRow!, content: "ការសិក្សា".repeat(200) } }),
    );
    // A space-split count would read this as one word and report ~0%.
    expect(khmer.completeness).toBeGreaterThan(0.5);
  });

  it("flags an empty section as the highest-severity finding", () => {
    const health = reviewSection(input({ sectionRow: { ...input().sectionRow!, content: "" } }));
    expect(health.findings[0]).toMatchObject({ severity: "HIGH", action: "write_content" });
  });
});

describe("evidence findings", () => {
  it("raises a HIGH finding for a claim its evidence contradicts", () => {
    const health = reviewSection(input({ claims: [claim({ evidence_status: "UNSUPPORTED" })] }));
    const finding = health.findings.find((f) => f.action === "find_evidence");
    expect(finding?.severity).toBe("HIGH");
    expect(finding?.claim).toContain("Postpartum depression");
  });

  it("raises a MEDIUM finding for a claim still awaiting verification", () => {
    const health = reviewSection(input({ claims: [claim({ evidence_status: "NEEDS_VERIFICATION" })] }));
    expect(health.findings.find((f) => f.action === "find_evidence")?.severity).toBe("MEDIUM");
  });

  it("raises nothing for a claim that does not require evidence", () => {
    const health = reviewSection(
      input({ claims: [claim({ claim_type: "inference", needs_evidence: false, evidence_status: "INFERENCE" })] }),
    );
    expect(health.findings.filter((f) => f.action === "find_evidence")).toHaveLength(0);
  });

  it("reports coverage as not applicable when nothing requires evidence", () => {
    const health = reviewSection(
      input({ claims: [claim({ claim_type: "interpretive", needs_evidence: false, evidence_status: "INFERENCE" })] }),
    );
    expect(health.evidenceCoverage).toBeNull();
  });
});

describe("alignment and citation integrity", () => {
  it("measures whether the chain this section follows from exists", () => {
    // research_problem's policy names only `title` as a prior section.
    const health = reviewSection(input({ presentPriorSections: ["title"] }));
    expect(health.researchAlignment).toBe(1);
  });

  it("flags a written section whose earlier sections are empty", () => {
    const health = reviewSection(input({ presentPriorSections: [] }));
    expect(health.researchAlignment).toBe(0);
    expect(health.findings.some((f) => f.action === "review_alignment")).toBe(true);
  });

  it("does not flag missing prior sections when this section is empty too", () => {
    // Nothing is out of order yet; telling a researcher their empty section is
    // misaligned with another empty section is noise.
    const health = reviewSection(
      input({ presentPriorSections: [], sectionRow: { ...input().sectionRow!, content: "" } }),
    );
    expect(health.findings.some((f) => f.action === "review_alignment")).toBe(false);
  });

  it("scores citation integrity from resolved versus total keys", () => {
    const health = reviewSection(
      input({ resolvedCitationKeys: ["sok2024"], unresolvedCitationKeys: ["invented2020"] }),
    );
    expect(health.citationIntegrity).toBe(0.5);
    expect(health.findings.some((f) => f.action === "verify_citation")).toBe(true);
  });

  it("reports null rather than a score when there are no citations", () => {
    const health = reviewSection(input());
    expect(health.citationIntegrity).toBeNull();
    expect(health.explanations.citationIntegrity).toContain("No citations");
  });

  it("orders findings by severity so the worst problem is first", () => {
    const health = reviewSection(
      input({
        claims: [claim({ id: "a", evidence_status: "NEEDS_VERIFICATION" })],
        unresolvedCitationKeys: ["invented2020"],
      }),
    );
    expect(health.findings[0].severity).toBe("HIGH");
  });

  it("gives every finding a machine-readable next step", () => {
    const health = reviewSection(
      input({ claims: [claim({ evidence_status: "UNSUPPORTED" })], unresolvedCitationKeys: ["x2020y"] }),
    );
    for (const finding of health.findings) {
      expect(finding.action).not.toBe("none");
      expect(finding.recommendation.length).toBeGreaterThan(10);
    }
  });
});
