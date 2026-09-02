import { describe, expect, it } from "vitest";
import { verifyClaimCitation } from "../citation-verification";
import type { ClaimType } from "../../db/types";

const CITATIONS = [{ id: "cit-1", citation_key: "smith2024" }];

function claim(over: Partial<{ id: string; claim_text: string; claim_type: ClaimType }> = {}) {
  return {
    id: "claim-1",
    claim_text: "Teacher motivation predicts classroom performance [smith2024].",
    claim_type: "factual" as ClaimType,
    ...over,
  };
}

describe("verifyClaimCitation", () => {
  it("returns not_applicable for a claim type that never needs evidence", () => {
    const result = verifyClaimCitation(claim({ claim_type: "interpretive", claim_text: "This may suggest a link." }), [], [], []);
    expect(result.state).toBe("not_applicable");
  });

  it("returns missing when nothing is cited and nothing is linked", () => {
    const result = verifyClaimCitation(
      claim({ claim_text: "Teacher motivation predicts classroom performance." }),
      CITATIONS,
      [],
      [],
    );
    expect(result.state).toBe("missing");
  });

  it("returns unresolved when the cited key does not match any saved source", () => {
    const result = verifyClaimCitation(claim({ claim_text: "As shown in [ghost2099]." }), CITATIONS, [], []);
    expect(result.state).toBe("unresolved");
    expect(result.mentionedKeys).toEqual(["ghost2099"]);
  });

  it("returns unsupported when the citation resolves but no evidence is linked", () => {
    const result = verifyClaimCitation(claim(), CITATIONS, [], []);
    expect(result.state).toBe("unsupported");
    expect(result.resolvedCitationIds).toEqual(["cit-1"]);
  });

  it("returns verified when every linked support is SUPPORTED", () => {
    const evidence = [{ id: "ev-1", citation_id: "cit-1" }];
    const claimEvidence = [{ claim_id: "claim-1", evidence_id: "ev-1", support: "SUPPORTED" as const }];
    const result = verifyClaimCitation(claim(), CITATIONS, evidence, claimEvidence);
    expect(result.state).toBe("verified");
  });

  it("returns partial when support is mixed", () => {
    const evidence = [
      { id: "ev-1", citation_id: "cit-1" },
      { id: "ev-2", citation_id: "cit-1" },
    ];
    const claimEvidence = [
      { claim_id: "claim-1", evidence_id: "ev-1", support: "SUPPORTED" as const },
      { claim_id: "claim-1", evidence_id: "ev-2", support: "PARTIAL" as const },
    ];
    const result = verifyClaimCitation(claim(), CITATIONS, evidence, claimEvidence);
    expect(result.state).toBe("partial");
  });

  it("returns unsupported when every link contradicts or needs review", () => {
    const evidence = [{ id: "ev-1", citation_id: "cit-1" }];
    const claimEvidence = [{ claim_id: "claim-1", evidence_id: "ev-1", support: "UNSUPPORTED" as const }];
    const result = verifyClaimCitation(claim(), CITATIONS, evidence, claimEvidence);
    expect(result.state).toBe("unsupported");
  });

  it("falls back to a claim's other links when the mentioned key doesn't match the linked evidence's source", () => {
    // Claim text cites smith2024, but the researcher actually linked evidence
    // from a different (also real) source — the claim has evidence, so it
    // must not be reported as "missing".
    const citations = [...CITATIONS, { id: "cit-2", citation_key: "lee2023" }];
    const evidence = [{ id: "ev-1", citation_id: "cit-2" }];
    const claimEvidence = [{ claim_id: "claim-1", evidence_id: "ev-1", support: "SUPPORTED" as const }];
    const result = verifyClaimCitation(claim(), citations, evidence, claimEvidence);
    expect(result.state).toBe("verified");
  });
});
