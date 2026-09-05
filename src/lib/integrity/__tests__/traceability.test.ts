import { describe, expect, it } from "vitest";
import { buildClaimTraceability } from "../traceability";

describe("buildClaimTraceability", () => {
  it("pairs each claim with its citation state and its own methodology links only", () => {
    const claims = [
      { id: "c1", claim_text: "Motivation predicts performance [smith2024].", claim_type: "factual" as const },
      { id: "c2", claim_text: "Engagement was also considered.", claim_type: "interpretive" as const },
    ];
    const citations = [{ id: "cit-1", citation_key: "smith2024" }];
    const evidence = [{ id: "ev-1", citation_id: "cit-1" }];
    const claimEvidence = [{ claim_id: "c1", evidence_id: "ev-1", support: "SUPPORTED" as const }];
    const links = [
      {
        id: "link-1",
        project_id: "p1",
        claim_id: "c1",
        construct_id: "construct-1",
        hypothesis_id: null,
        indicator_id: null,
        objective_id: null,
        question_id: null,
        note: null,
        created_at: "",
      },
    ];

    const result = buildClaimTraceability(claims, citations, evidence, claimEvidence, links);

    expect(result).toHaveLength(2);
    expect(result[0].citation.state).toBe("verified");
    expect(result[0].methodologyLinks).toHaveLength(1);
    expect(result[1].citation.state).toBe("not_applicable");
    expect(result[1].methodologyLinks).toHaveLength(0);
  });
});
