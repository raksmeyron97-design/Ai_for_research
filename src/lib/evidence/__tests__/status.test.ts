import { describe, expect, it } from "vitest";
import { claimNeedsEvidence, computeCoverage, deriveClaimStatus, initialStatusFor } from "../status";
import type { ClaimType, EvidenceStatusLabel } from "../../db/types";

/**
 * Phase 17 §6 and §18. These rules are the reason evidence coverage is a
 * number anyone can check, so they are asserted rather than assumed.
 */
describe("which claims require evidence", () => {
  it.each<ClaimType>(["factual", "statistical", "clinical", "comparative"])(
    "%s claims require evidence",
    (type) => expect(claimNeedsEvidence(type)).toBe(true),
  );

  it.each<ClaimType>(["interpretive", "user_provided", "inference"])(
    "%s claims do not — §5 is explicit that not every sentence needs a citation",
    (type) => expect(claimNeedsEvidence(type)).toBe(false),
  );
});

describe("initial status", () => {
  it("starts an evidence-requiring claim as unverified, never supported", () => {
    expect(initialStatusFor("factual")).toBe("NEEDS_VERIFICATION");
    expect(initialStatusFor("statistical")).toBe("NEEDS_VERIFICATION");
  });

  it("labels a claim that carries its own provenance", () => {
    expect(initialStatusFor("user_provided")).toBe("USER_PROVIDED");
    expect(initialStatusFor("inference")).toBe("INFERENCE");
    expect(initialStatusFor("interpretive")).toBe("INFERENCE");
  });
});

describe("deriving status from linked evidence", () => {
  it("stays unverified with no evidence attached", () => {
    expect(deriveClaimStatus("factual", [])).toBe("NEEDS_VERIFICATION");
  });

  // The rule §6 exists for: attaching a source is not the same as checking it.
  it("does NOT become supported merely because evidence exists", () => {
    expect(deriveClaimStatus("factual", ["NEEDS_REVIEW"])).toBe("NEEDS_VERIFICATION");
    expect(deriveClaimStatus("factual", ["SUPPORTED", "NEEDS_REVIEW"])).toBe("NEEDS_VERIFICATION");
  });

  it("becomes supported only when every link says so", () => {
    expect(deriveClaimStatus("factual", ["SUPPORTED"])).toBe("SUPPORTED");
    expect(deriveClaimStatus("factual", ["SUPPORTED", "SUPPORTED"])).toBe("SUPPORTED");
  });

  it("is partially supported when sources disagree", () => {
    expect(deriveClaimStatus("factual", ["SUPPORTED", "UNSUPPORTED"])).toBe("PARTIALLY_SUPPORTED");
    expect(deriveClaimStatus("factual", ["SUPPORTED", "PARTIAL"])).toBe("PARTIALLY_SUPPORTED");
    expect(deriveClaimStatus("factual", ["PARTIAL"])).toBe("PARTIALLY_SUPPORTED");
  });

  it("is unsupported when every link contradicts it", () => {
    expect(deriveClaimStatus("factual", ["UNSUPPORTED", "UNSUPPORTED"])).toBe("UNSUPPORTED");
  });

  it("keeps an inference an inference no matter what is cited", () => {
    // Citing something does not turn the researcher's reading into a fact.
    expect(deriveClaimStatus("inference", ["SUPPORTED", "SUPPORTED"])).toBe("INFERENCE");
    expect(deriveClaimStatus("interpretive", ["SUPPORTED"])).toBe("INFERENCE");
  });

  it("keeps a user-provided claim user-provided", () => {
    expect(deriveClaimStatus("user_provided", ["SUPPORTED"])).toBe("USER_PROVIDED");
  });
});

function claim(status: EvidenceStatusLabel, needs = true) {
  return { needs_evidence: needs, evidence_status: status };
}

describe("evidence coverage", () => {
  it("matches the worked example from the brief", () => {
    // 10 evidence-requiring claims: 7 supported, 2 partial, 1 unsupported.
    const claims = [
      ...Array(7).fill(claim("SUPPORTED")),
      ...Array(2).fill(claim("PARTIALLY_SUPPORTED")),
      claim("UNSUPPORTED"),
    ];
    const result = computeCoverage(claims);

    expect(result.requiring).toBe(10);
    expect(result.supported).toBe(7);
    // 7 + (2 x 0.5) = 8 of 10.
    expect(result.coverage).toBeCloseTo(0.8, 10);
  });

  it("excludes claims that do not require evidence from the denominator", () => {
    const result = computeCoverage([
      claim("SUPPORTED"),
      claim("INFERENCE", false),
      claim("USER_PROVIDED", false),
    ]);
    expect(result.requiring).toBe(1);
    expect(result.coverage).toBe(1);
  });

  it("distinguishes 'not applicable' from 0%", () => {
    // A section of pure interpretation has no coverage figure, which is not
    // the same as scoring zero.
    const result = computeCoverage([claim("INFERENCE", false)]);
    expect(result.coverage).toBeNull();
    expect(result.explanation).toContain("does not apply");
  });

  it("reports 0 when everything requiring evidence lacks it", () => {
    const result = computeCoverage([claim("UNSUPPORTED"), claim("NEEDS_VERIFICATION")]);
    expect(result.coverage).toBe(0);
  });

  it("explains exactly how the number was reached", () => {
    const result = computeCoverage([claim("SUPPORTED"), claim("PARTIALLY_SUPPORTED")]);
    // §16/§18: the figure has to be explainable, not asserted.
    expect(result.explanation).toContain("2 claim(s) require evidence");
    expect(result.explanation).toContain("counted as half");
  });

  it("counts an unverified claim against coverage rather than ignoring it", () => {
    const result = computeCoverage([claim("SUPPORTED"), claim("NEEDS_VERIFICATION")]);
    expect(result.coverage).toBe(0.5);
    expect(result.needsVerification).toBe(1);
  });
});
