import { describe, expect, it } from "vitest";
import { scanUnsupportedClaims } from "../unsupported-scan";

function claim(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    claim_type: "factual",
    evidence_status: "NEEDS_VERIFICATION",
    section_type: "results",
    claim_text: "Motivation predicts performance.",
    ...over,
  };
}

describe("scanUnsupportedClaims", () => {
  it("flags a factual claim with no evidence linked", () => {
    const findings = scanUnsupportedClaims([claim()] as never);
    expect(findings).toHaveLength(1);
    expect(findings[0].targetId).toBe("c1");
    expect(findings[0].category).toBe("citation");
  });

  it("never flags an interpretive claim, even with no citation", () => {
    const findings = scanUnsupportedClaims([
      claim({ id: "c2", claim_type: "interpretive", evidence_status: "INFERENCE" }),
    ] as never);
    expect(findings).toHaveLength(0);
  });

  it("never flags a user_provided or inference claim", () => {
    const findings = scanUnsupportedClaims([
      claim({ id: "c3", claim_type: "user_provided", evidence_status: "USER_PROVIDED" }),
      claim({ id: "c4", claim_type: "inference", evidence_status: "INFERENCE" }),
    ] as never);
    expect(findings).toHaveLength(0);
  });

  it("does not flag a claim that is SUPPORTED or PARTIALLY_SUPPORTED", () => {
    const findings = scanUnsupportedClaims([
      claim({ id: "c5", evidence_status: "SUPPORTED" }),
      claim({ id: "c6", evidence_status: "PARTIALLY_SUPPORTED" }),
    ] as never);
    expect(findings).toHaveLength(0);
  });

  it("gives a higher severity to UNSUPPORTED (evidence exists but contradicts) than NEEDS_VERIFICATION (nothing linked yet)", () => {
    const findings = scanUnsupportedClaims([
      claim({ id: "c7", evidence_status: "UNSUPPORTED" }),
      claim({ id: "c8", evidence_status: "NEEDS_VERIFICATION" }),
    ] as never);
    const bySeverity = Object.fromEntries(findings.map((f) => [f.targetId, f.severity]));
    expect(bySeverity.c7).toBe("warning");
    expect(bySeverity.c8).toBe("info");
  });

  it("scopes to a single section when sectionType is given", () => {
    const findings = scanUnsupportedClaims(
      [claim({ id: "c9", section_type: "results" }), claim({ id: "c10", section_type: "discussion" })] as never,
      { sectionType: "results" as never },
    );
    expect(findings.map((f) => f.targetId)).toEqual(["c9"]);
  });
});
