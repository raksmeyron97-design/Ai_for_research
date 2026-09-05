import { describe, expect, it } from "vitest";
import { computeCitationFunnel } from "../citation-funnel";

describe("computeCitationFunnel", () => {
  it("returns all-zero counts for an empty project, never a divide-by-zero or NaN", () => {
    const funnel = computeCitationFunnel([], [], [], []);
    expect(funnel).toEqual({
      requiringEvidence: 0,
      cited: 0,
      linkedToEvidence: 0,
      linkedToResolvableSource: 0,
    });
  });

  it("computes each stage independently, matching the spec's worked example shape", () => {
    const claims = [
      { id: "c1", claim_text: "Cited and fully linked [smith2024].", claim_type: "factual" as const },
      { id: "c2", claim_text: "Cited in text but no evidence curated yet [lee2023].", claim_type: "factual" as const },
      { id: "c3", claim_text: "No citation at all.", claim_type: "statistical" as const },
      { id: "c4", claim_text: "Interpretive, does not require evidence.", claim_type: "interpretive" as const },
    ];
    const citations = [
      { id: "cit-smith" },
      { id: "cit-lee" },
    ];
    const evidence = [{ id: "ev-1", citation_id: "cit-smith" }];
    const claimEvidence = [{ claim_id: "c1", evidence_id: "ev-1" }];

    const funnel = computeCitationFunnel(claims, claimEvidence, evidence, citations);
    expect(funnel).toEqual({
      requiringEvidence: 3, // c1, c2, c3 — c4 is interpretive
      cited: 2, // c1, c2
      linkedToEvidence: 1, // c1 only
      linkedToResolvableSource: 1, // c1's evidence resolves to a real citation
    });
  });

  it("never counts a claim type that does not require evidence, even if it happens to mention a citation", () => {
    const claims = [{ id: "c1", claim_text: "This might suggest [smith2024] is relevant.", claim_type: "interpretive" as const }];
    const funnel = computeCitationFunnel(claims, [], [], []);
    expect(funnel.requiringEvidence).toBe(0);
    expect(funnel.cited).toBe(0);
  });
});
