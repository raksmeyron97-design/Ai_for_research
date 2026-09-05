import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemorySupabase } from "../../ai/testing/in-memory-supabase";
import { createClaims } from "../../db/evidence";
import { buildResearchIntegrityReview } from "../review-service";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Cross-cutting regressions that don't belong to any single check module
 * (§34): every metric's empty-denominator case is null, never zero, and
 * every finding the review produces is provenance: "deterministic" — an
 * ai_suggested proposal never becomes part of the authoritative review
 * (`suggestions.ts`'s functions are never called from `review-service.ts`,
 * and this proves the effect of that, not just the intent).
 */
describe("metrics: null means not-computable, never zero, across every dimension", () => {
  it("returns null for every metric on a project with nothing to check", async () => {
    const db = createInMemorySupabase({
      research_projects: [{ id: PROJECT_ID, user_id: "u1", title: "T", language: "en", status: "active" }],
    });
    const review = await buildResearchIntegrityReview(db.client as SupabaseClient, PROJECT_ID);

    expect(review.metrics.length).toBeGreaterThan(0);
    for (const metric of review.metrics) {
      expect(metric.value).toBeNull();
      expect(metric.status).toBe("not_computable");
      expect(metric.reason).toBeTruthy();
    }
  });
});

describe("provenance: every finding the review produces is deterministic", () => {
  it("never includes an ai_suggested finding in the authoritative review", async () => {
    const db = createInMemorySupabase({
      research_projects: [{ id: PROJECT_ID, user_id: "u1", title: "T", language: "en", status: "active" }],
    });
    const client = db.client as SupabaseClient;

    await createClaims(client, [
      { project_id: PROJECT_ID, section_type: "results", claim_text: "The intervention caused an increase.", claim_type: "factual" },
      { project_id: PROJECT_ID, section_type: "discussion", claim_text: "Prevalence was 60%.", claim_type: "statistical" },
    ]);

    const review = await buildResearchIntegrityReview(client, PROJECT_ID);
    expect(review.findings.length).toBeGreaterThan(0);
    for (const finding of review.findings) {
      expect(finding.provenance).toBe("deterministic");
    }
  });
});
