import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { createClaims, createEvidence, linkClaimEvidence, refreshClaimStatus } from "../../db/evidence";
import { buildResearchIntegrityReview } from "../review-service";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function seed() {
  return createInMemorySupabase({
    research_projects: [
      { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", status: "active" },
    ],
    research_citations: [
      {
        id: "cit1", project_id: PROJECT_ID, citation_key: "smith2024", title: "A study of motivation",
        authors: ["Smith, J."], year: 2024, journal: "J. of Things", doi: null, pmid: null, isbn: null,
        url: null, source_type: "article", tier: 2, status: "verified",
      },
    ],
  });
}

describe("buildResearchIntegrityReview — the deterministic E2E path (§36)", () => {
  it("goes from a fully-traced claim to a gap and back, recomputed from stored rows each time", async () => {
    const db = seed();
    const client = db.client as SupabaseClient;

    const [claim] = await createClaims(client, [
      {
        project_id: PROJECT_ID,
        section_type: "results",
        claim_text: "Motivation predicts classroom performance [smith2024].",
        claim_type: "factual",
      },
    ]);

    // 1. Cited, but not yet linked to evidence -> should show up as a gap.
    const beforeEvidence = await buildResearchIntegrityReview(client, PROJECT_ID);
    expect(beforeEvidence.coverage.citation.cited).toBe(1);
    expect(beforeEvidence.coverage.citation.linkedToEvidence).toBe(0);
    const unsupportedFinding = beforeEvidence.findings.find((f) => f.targetId === claim.id && f.category === "citation");
    expect(unsupportedFinding).toBeTruthy();

    // 2. Researcher links evidence that supports the claim.
    const evidence = await createEvidence(client, {
      project_id: PROJECT_ID,
      citation_id: "cit1",
      excerpt: "We found motivation strongly predicts classroom performance.",
    });
    const link = await linkClaimEvidence(client, {
      project_id: PROJECT_ID,
      claim_id: claim.id,
      evidence_id: evidence.id,
      support: "SUPPORTED",
    });
    // The real write path (insertEvidence) refreshes the claim's derived
    // status after linking — done here explicitly since the test calls the
    // lower-level db functions directly.
    await refreshClaimStatus(client, PROJECT_ID, claim.id);

    // 3. Re-running the review recomputes from the new rows — nothing was cached.
    const afterEvidence = await buildResearchIntegrityReview(client, PROJECT_ID);
    expect(afterEvidence.coverage.citation.linkedToEvidence).toBe(1);
    expect(afterEvidence.coverage.citation.linkedToResolvableSource).toBe(1);
    expect(afterEvidence.findings.some((f) => f.targetId === claim.id && f.category === "citation")).toBe(false);
    const claimTraceability = afterEvidence.metrics.find((m) => m.id === "claim_traceability");
    expect(claimTraceability?.value).toBe(1);

    // 4. Removing the link (e.g. the researcher decides it wasn't a good match)
    //    makes the gap reappear — the review has no memory of step 3.
    await client.from("research_claim_evidence").delete().eq("id", link.id);
    await refreshClaimStatus(client, PROJECT_ID, claim.id);
    const afterRemoval = await buildResearchIntegrityReview(client, PROJECT_ID);
    expect(afterRemoval.coverage.citation.linkedToEvidence).toBe(0);
    expect(afterRemoval.findings.some((f) => f.targetId === claim.id && f.category === "citation")).toBe(true);
  });

  it("returns null-valued, not_computable metrics for a project with nothing to check, never zero", async () => {
    const db = createInMemorySupabase({
      research_projects: [{ id: PROJECT_ID, user_id: "u1", title: "T", language: "en", status: "active" }],
    });
    const review = await buildResearchIntegrityReview(db.client as SupabaseClient, PROJECT_ID);

    const citationCoverage = review.metrics.find((m) => m.id === "citation_coverage");
    expect(citationCoverage?.value).toBeNull();
    expect(citationCoverage?.status).toBe("not_computable");
    expect(review.findings).toEqual([]);
  });
});
