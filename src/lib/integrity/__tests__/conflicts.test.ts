import { describe, expect, it } from "vitest";
import { buildSourceConflicts, type SourceConflictView } from "../conflicts";

const CITATIONS = [
  { id: "cit-a", citation_key: "smith2024" },
  { id: "cit-b", citation_key: "lee2023" },
  { id: "cit-c", citation_key: "park2022" },
];

const EVIDENCE = [
  { id: "ev-a", citation_id: "cit-a", excerpt: "We found a strong positive effect." },
  { id: "ev-b", citation_id: "cit-b", excerpt: "No significant association was found." },
  { id: "ev-c", citation_id: "cit-c", excerpt: "The effect ran in the opposite direction." },
];

describe("buildSourceConflicts", () => {
  it("has no consensus/aggregate score field on the returned type", () => {
    const view = buildSourceConflicts("c1", [], [], []);
    // Structural guarantee, not just a runtime check: the type itself must
    // never grow a numeric consensus field.
    const keys: (keyof SourceConflictView)[] = ["claimId", "entries", "hasConflict"];
    expect(Object.keys(view).sort()).toEqual(keys.sort());
  });

  it("flags a conflict when linked sources disagree", () => {
    const claimEvidence = [
      { claim_id: "c1", evidence_id: "ev-a", support: "SUPPORTED" as const, note: null },
      { claim_id: "c1", evidence_id: "ev-b", support: "PARTIAL" as const, note: null },
      { claim_id: "c1", evidence_id: "ev-c", support: "UNSUPPORTED" as const, note: null },
    ];
    const view = buildSourceConflicts("c1", claimEvidence, EVIDENCE, CITATIONS);
    expect(view.hasConflict).toBe(true);
    expect(view.entries).toHaveLength(3);
    expect(view.entries.map((e) => e.support).sort()).toEqual(["PARTIAL", "SUPPORTED", "UNSUPPORTED"]);
  });

  it("does not flag a conflict when every linked source agrees", () => {
    const claimEvidence = [
      { claim_id: "c1", evidence_id: "ev-a", support: "SUPPORTED" as const, note: null },
    ];
    const view = buildSourceConflicts("c1", claimEvidence, EVIDENCE, CITATIONS);
    expect(view.hasConflict).toBe(false);
  });

  it("only includes entries for the given claim", () => {
    const claimEvidence = [
      { claim_id: "c1", evidence_id: "ev-a", support: "SUPPORTED" as const, note: null },
      { claim_id: "c2", evidence_id: "ev-b", support: "PARTIAL" as const, note: null },
    ];
    const view = buildSourceConflicts("c1", claimEvidence, EVIDENCE, CITATIONS);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].citationKey).toBe("smith2024");
  });
});
