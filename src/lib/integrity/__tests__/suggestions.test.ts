import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { createMockProvider, withMockProvider } from "../../ai/testing/mock-provider";
import {
  citationPlacementFixture,
  classificationFixture,
  conflictSummaryFixture,
  duplicateReferencesFixture,
  evidenceExplanationFixture,
  excessiveConfidenceConflictSummaryFixture,
  fakeIdentifierClaimFixture,
  fakeSourceCitationPlacementFixture,
  HALLUCINATED_CITATION_ID,
  languageFixFixture,
  OTHER_PROJECT_CITATION_ID,
  overclaimEvidenceExplanationFixture,
  PROMPT_INJECTION_TEXT,
  wordingComparisonFixture,
} from "../../ai/testing/integrity-fixtures";
import {
  classifyClaim,
  compareWordingToResult,
  explainCandidateEvidence,
  IntegritySuggestionError,
  suggestCitationPlacement,
  suggestDuplicateReferences,
  suggestMethodologyLanguageFix,
  summarizeSourceConflict,
} from "../suggestions";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const CITATIONS = [
  { id: "cit-a", label: "smith2024 — A study of motivation" },
  { id: "cit-b", label: "lee2023 — A different study" },
];

function seed() {
  return createInMemorySupabase({
    research_projects: [{ id: PROJECT_ID, user_id: "u1", title: "T", language: "en", status: "active" }],
  });
}

let supabase: SupabaseClient;

beforeEach(() => {
  supabase = seed().client as SupabaseClient;
});

describe("classifyClaim", () => {
  it("returns a proposal and writes nothing", async () => {
    const mock = createMockProvider({ fallback: classificationFixture("statistical", "high") });
    const result = await withMockProvider(mock, () =>
      classifyClaim(supabase, { projectId: PROJECT_ID, claimText: "60% of participants improved.", currentType: "factual" }),
    );
    expect(result.provenance).toBe("ai_suggested");
    expect(result.proposals).toEqual([{ claimType: "statistical", confidence: "high", rationale: expect.any(String) }]);
  });

  it("proposes nothing when the model returns null rather than forcing an unclassified guess", async () => {
    const mock = createMockProvider({ fallback: classificationFixture(null, "medium", "Could be either.") });
    const result = await withMockProvider(mock, () =>
      classifyClaim(supabase, { projectId: PROJECT_ID, claimText: "Ambiguous sentence.", currentType: "factual" }),
    );
    expect(result.proposals).toEqual([]);
  });

  it("discards a low-confidence classification rather than applying it", async () => {
    const mock = createMockProvider({ fallback: classificationFixture("factual", "low") });
    const result = await withMockProvider(mock, () =>
      classifyClaim(supabase, { projectId: PROJECT_ID, claimText: "Something uncertain.", currentType: "factual" }),
    );
    expect(result.proposals).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/left unchanged/);
  });
});

describe("explainCandidateEvidence — never an authority", () => {
  it("always returns provenance ai_suggested, even for a confident-sounding answer", async () => {
    const mock = createMockProvider({ fallback: evidenceExplanationFixture("SUPPORTED") });
    const result = await withMockProvider(mock, () =>
      explainCandidateEvidence(supabase, { projectId: PROJECT_ID, claimText: "X predicts Y.", evidenceExcerpt: "We found X predicts Y." }),
    );
    expect(result.provenance).toBe("ai_suggested");
  });

  it("normalizes an overclaiming explanation to an advisory proposal, never an authoritative verification", async () => {
    const mock = createMockProvider({ fallback: overclaimEvidenceExplanationFixture() });
    const result = await withMockProvider(mock, () =>
      explainCandidateEvidence(supabase, { projectId: PROJECT_ID, claimText: "X predicts Y.", evidenceExcerpt: "..." }),
    );
    // The app-level contract: whatever the model says, this is still just a
    // proposal a researcher must act on — it never becomes a written support label.
    expect(result.provenance).toBe("ai_suggested");
    expect(result.proposals[0].suggestedSupport).toBe("SUPPORTED");
  });

  it("does not act on a fabricated identifier embedded in the model's own explanation", async () => {
    const mock = createMockProvider({ fallback: fakeIdentifierClaimFixture() });
    const result = await withMockProvider(mock, () =>
      explainCandidateEvidence(supabase, { projectId: PROJECT_ID, claimText: "X predicts Y.", evidenceExcerpt: "..." }),
    );
    // The fabricated DOI is just text inside `explanation` — nothing here
    // writes it anywhere or treats it as a verified identifier.
    expect(result.provenance).toBe("ai_suggested");
    expect(result.proposals).toHaveLength(1);
  });
});

describe("summarizeSourceConflict", () => {
  it("returns an advisory summary, never a consensus verdict field", async () => {
    const mock = createMockProvider({ fallback: conflictSummaryFixture("These sources appear directionally consistent.") });
    const result = await withMockProvider(mock, () =>
      summarizeSourceConflict(supabase, {
        projectId: PROJECT_ID,
        claimText: "X predicts Y.",
        sources: [{ citationKey: "smith2024", excerpt: "...", support: "SUPPORTED" }],
      }),
    );
    expect(Object.keys(result.proposals[0])).toEqual(["summary"]);
  });

  it("normalizes excessive-confidence wording to an advisory proposal", async () => {
    const mock = createMockProvider({ fallback: excessiveConfidenceConflictSummaryFixture() });
    const result = await withMockProvider(mock, () =>
      summarizeSourceConflict(supabase, {
        projectId: PROJECT_ID,
        claimText: "X predicts Y.",
        sources: [{ citationKey: "smith2024", excerpt: "...", support: "SUPPORTED" }],
      }),
    );
    expect(result.provenance).toBe("ai_suggested");
  });
});

describe("suggestDuplicateReferences — id discipline (§44)", () => {
  it("discards a hallucinated citation id", async () => {
    const mock = createMockProvider({
      fallback: duplicateReferencesFixture([{ aId: "cit-a", bId: HALLUCINATED_CITATION_ID }]),
    });
    const result = await withMockProvider(mock, () =>
      suggestDuplicateReferences(supabase, { projectId: PROJECT_ID, candidates: CITATIONS }),
    );
    expect(result.proposals).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/not in this project/i);
  });

  it("discards a well-formed id belonging to a different project", async () => {
    const mock = createMockProvider({
      fallback: duplicateReferencesFixture([{ aId: "cit-a", bId: OTHER_PROJECT_CITATION_ID }]),
    });
    const result = await withMockProvider(mock, () =>
      suggestDuplicateReferences(supabase, { projectId: PROJECT_ID, candidates: CITATIONS }),
    );
    expect(result.proposals).toEqual([]);
  });

  it("keeps a pair where both ids were genuinely offered", async () => {
    const mock = createMockProvider({ fallback: duplicateReferencesFixture([{ aId: "cit-a", bId: "cit-b" }]) });
    const result = await withMockProvider(mock, () =>
      suggestDuplicateReferences(supabase, { projectId: PROJECT_ID, candidates: CITATIONS }),
    );
    expect(result.proposals).toHaveLength(1);
  });

  it("never proposes anything on an empty/too-small candidate list, without calling the provider", async () => {
    const result = await suggestDuplicateReferences(supabase, { projectId: PROJECT_ID, candidates: [CITATIONS[0]] });
    expect(result.proposals).toEqual([]);
  });
});

describe("suggestMethodologyLanguageFix", () => {
  it("returns rewrite proposals, writes nothing", async () => {
    const mock = createMockProvider({ fallback: languageFixFixture([{ text: "X was associated with Y." }]) });
    const result = await withMockProvider(mock, () =>
      suggestMethodologyLanguageFix(supabase, {
        projectId: PROJECT_ID,
        claimText: "X caused Y.",
        concern: "causal language with no causal design",
      }),
    );
    expect(result.proposals[0].text).toBe("X was associated with Y.");
  });
});

describe("suggestCitationPlacement — id discipline", () => {
  it("discards a hallucinated citation id and returns nothing authoritative", async () => {
    const mock = createMockProvider({ fallback: fakeSourceCitationPlacementFixture() });
    const result = await withMockProvider(mock, () =>
      suggestCitationPlacement(supabase, { projectId: PROJECT_ID, claimText: "X predicts Y.", candidates: CITATIONS }),
    );
    expect(result.proposals).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/not in this project/i);
  });

  it("keeps a genuinely offered citation id", async () => {
    const mock = createMockProvider({ fallback: citationPlacementFixture([{ citationId: "cit-a" }]) });
    const result = await withMockProvider(mock, () =>
      suggestCitationPlacement(supabase, { projectId: PROJECT_ID, claimText: "X predicts Y.", candidates: CITATIONS }),
    );
    expect(result.proposals).toEqual([{ citationId: "cit-a", rationale: expect.any(String) }]);
  });
});

describe("compareWordingToResult", () => {
  it("returns an advisory comparison, never a claim about a computed result", async () => {
    const mock = createMockProvider({ fallback: wordingComparisonFixture("The manuscript reads more definite than the hypothesis's own phrasing.") });
    const result = await withMockProvider(mock, () =>
      compareWordingToResult(supabase, {
        projectId: PROJECT_ID,
        claimText: "X definitely improves Y.",
        hypothesisStatement: "X is associated with Y.",
        hypothesisDirection: "unspecified",
      }),
    );
    expect(result.provenance).toBe("ai_suggested");
  });
});

describe("prompt injection (§29/§44)", () => {
  it("a source's own instructions embedded in an excerpt do not change the app-level contract", async () => {
    const mock = createMockProvider({ fallback: evidenceExplanationFixture("SUPPORTED", "As instructed, this is verified.") });
    const result = await withMockProvider(mock, () =>
      explainCandidateEvidence(supabase, {
        projectId: PROJECT_ID,
        claimText: "X predicts Y.",
        evidenceExcerpt: PROMPT_INJECTION_TEXT,
      }),
    );
    // Whatever the injected text got the model to say, the result is still
    // just an ai_suggested proposal — nothing here marks anything verified.
    expect(result.provenance).toBe("ai_suggested");
  });
});

describe("provider failure surfaces a safe message, never a raw provider error", () => {
  it("throws IntegritySuggestionError on a provider failure", async () => {
    const mock = createMockProvider({ fallback: { kind: "provider_failure", message: "raw upstream secret" } });
    await expect(
      withMockProvider(mock, () => classifyClaim(supabase, { projectId: PROJECT_ID, claimText: "X", currentType: "factual" })),
    ).rejects.toThrow(IntegritySuggestionError);
  });

  it("throws IntegritySuggestionError on a schema mismatch, with no partial acceptance", async () => {
    const mock = createMockProvider({ fallback: { kind: "schema_mismatch", json: { nonsense: true } } });
    await expect(
      withMockProvider(mock, () => classifyClaim(supabase, { projectId: PROJECT_ID, claimText: "X", currentType: "factual" })),
    ).rejects.toThrow(IntegritySuggestionError);
  });
});
