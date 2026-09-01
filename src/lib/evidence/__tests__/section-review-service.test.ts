import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { createClaims } from "../../db/evidence";
import { buildSectionReview } from "../section-review-service";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function seed(sectionContent: string) {
  return createInMemorySupabase({
    research_projects: [
      { id: PROJECT_ID, user_id: "u1", title: "T", language: "en", target_population: [], status: "active" },
    ],
    research_sections: [
      { id: "s-problem", project_id: PROJECT_ID, section_type: "research_problem", content: sectionContent, status: "in_progress", metadata: {} },
      { id: "s-title", project_id: PROJECT_ID, section_type: "title", content: "A title", status: "completed", metadata: {} },
    ],
    research_citations: [
      { id: "cit1", project_id: PROJECT_ID, citation_key: "sok2024", title: "Study", authors: [], year: 2024, status: "user_provided", tier: 2 },
    ],
  });
}

let db: ReturnType<typeof seed>;

beforeEach(() => {
  db = seed("Postpartum depression affects maternal wellbeing [sok2024]. ".repeat(20));
});

describe("the normalized section review", () => {
  it("returns one response carrying every metric with its explanation", async () => {
    const review = await buildSectionReview(db.client as SupabaseClient, PROJECT_ID, "research_problem");

    for (const metric of [review.completeness, review.evidenceCoverage, review.alignment, review.citationIntegrity]) {
      expect(metric.label).toBeTruthy();
      expect(metric.explanation).toBeTruthy();
    }
    expect(review.sectionId).toBe("s-problem");
  });

  it("reports a resolvable citation as intact and an invented one as broken", async () => {
    const intact = await buildSectionReview(db.client as SupabaseClient, PROJECT_ID, "research_problem");
    expect(intact.citationIntegrity.value).toBe(1);

    const broken = seed("A claim with an invented source [nosuchkey2024].");
    const review = await buildSectionReview(broken.client as SupabaseClient, PROJECT_ID, "research_problem");
    expect(review.citationIntegrity.value).toBe(0);
    const issue = review.issues.find((i) => i.action === "verify_citation");
    expect(issue?.citationKey).toBe("nosuchkey2024");
  });

  it("reports coverage as null rather than zero when nothing requires evidence", async () => {
    await createClaims(db.client as SupabaseClient, [
      { project_id: PROJECT_ID, section_type: "research_problem", claim_text: "My reading of this.", claim_type: "interpretive" },
    ]);

    const review = await buildSectionReview(db.client as SupabaseClient, PROJECT_ID, "research_problem");
    expect(review.evidenceCoverage.value).toBeNull();
    expect(review.evidenceCoverage.explanation).toMatch(/does not apply/);
  });

  it("gives each unverified claim an actionable issue carrying the claim id", async () => {
    const [claim] = await createClaims(db.client as SupabaseClient, [
      { project_id: PROJECT_ID, section_type: "research_problem", claim_text: "Prevalence is 20%.", claim_type: "statistical" },
    ]);

    const review = await buildSectionReview(db.client as SupabaseClient, PROJECT_ID, "research_problem");
    const issue = review.issues.find((i) => i.action === "find_evidence");
    expect(issue?.claimId).toBe(claim.id);
    expect(issue?.claim).toBe("Prevalence is 20%.");
  });

  it("counts only this section's claims, not the project's", async () => {
    await createClaims(db.client as SupabaseClient, [
      { project_id: PROJECT_ID, section_type: "research_problem", claim_text: "In this section.", claim_type: "factual" },
      { project_id: PROJECT_ID, section_type: "methodology", claim_text: "In another section.", claim_type: "factual" },
    ]);

    const review = await buildSectionReview(db.client as SupabaseClient, PROJECT_ID, "research_problem");
    expect(review.coverage.requiring).toBe(1);
  });

  it("treats a section that was never saved as empty rather than failing", async () => {
    const review = await buildSectionReview(db.client as SupabaseClient, PROJECT_ID, "rationale");
    expect(review.sectionId).toBeNull();
    expect(review.issues.some((i) => i.action === "write_content")).toBe(true);
  });
});
